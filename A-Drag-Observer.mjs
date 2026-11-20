import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { playPreview, previewDesign, previewDurationMs, previewPeak } from './A-Drag-Preview.mjs';
import { playFrames } from './A-Drag-Player.mjs';
import { designDurationMs, designPeak, sampleDesignFrame, validateDesign } from './A-Drag-Waveform.mjs';

const emptyPositions = { VestFront: [], VestBack: [] };
const maxDesignBytes = 512 * 1024;
const defaultObserverPort = 61045;
const workbenchHeader = 'X-Haptic-Waveform-Workbench';

function reply(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readDesign(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length <= maxDesignBytes) chunks.push(chunk);
  }
  if (length > maxDesignBytes) throw new Error('波形数据超过 512 KB。');
  let design;
  try { design = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('波形数据需要使用 JSON 格式。'); }
  return validateDesign(design);
}

function standaloneSource(design, playbackSource, waveformSource) {
  return `// bHaptics 马甲波形 · Node.js 22+
// 连接 bHaptics Player 后执行 node haptic-waveform.mjs --play
import { pathToFileURL } from 'node:url';

export const waveform = ${JSON.stringify(design, null, 2)};

${playbackSource.trim()}

${waveformSource.trim()}

export function playWaveform(options = {}) {
  const design = validateDesign(waveform);
  return playFrames({
    ...options, durationMs: designDurationMs(design),
    sampleFrame: (elapsedMs, key) => sampleDesignFrame(design, elapsedMs, key),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--play', 2)) {
    console.log('连接 bHaptics Player 后，运行 node haptic-waveform.mjs --play。');
  } else if (typeof WebSocket !== 'function' || typeof Promise.withResolvers !== 'function') {
    console.error('请使用 Node.js 22 或更新版本。');
    process.exitCode = 1;
  } else {
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    try {
      await playWaveform({ signal: stop.signal, onReady: () => console.log('正在播放波形。') });
      console.log('波形指令已发送完毕。');
    } catch (error) {
      if (stop.signal.aborted) console.log('已停止。');
      else { console.error(error.message); process.exitCode = 1; }
    }
  }
}
`;
}

export function createObserverServer({ play = playPreview, playCustom = playFrames } = {}) {
  const page = readFileSync(new URL('./A-Drag-Observer.html', import.meta.url));
  const playbackSource = readFileSync(new URL('./A-Drag-Player.mjs', import.meta.url), 'utf8');
  const waveformSource = readFileSync(new URL('./A-Drag-Waveform.mjs', import.meta.url), 'utf8');
  const arrangementSource = readFileSync(new URL('./A-Drag-Arrangement.mjs', import.meta.url), 'utf8');
  const subscribers = new Set();
  let trial = null;
  let snapshot = {
    phase: 'idle', direction: null, elapsedMs: 0, durationMs: previewDurationMs,
    peak: previewPeak, positions: emptyPositions, message: '选择预设或播放自己设计的波形。',
  };

  function sendSnapshot(response) {
    if (response.destroyed || response.writableEnded) return;
    if (!response.write(`data: ${JSON.stringify(snapshot)}\n\n`)) response.end();
  }

  function update(changes) {
    snapshot = { ...snapshot, ...changes };
    for (const response of subscribers) sendSnapshot(response);
  }

  function startTrial(direction, design) {
    const controller = new AbortController();
    const durationMs = design ? designDurationMs(design) : previewDurationMs;
    const peak = design ? designPeak(design) : previewPeak;
    const runner = design ? playCustom : play;
    const pattern = design
      ? { durationMs, sampleFrame: (elapsedMs, key) => sampleDesignFrame(design, elapsedMs, key) }
      : { reverse: direction === 'reverse' };
    trial = controller;
    update({ phase: 'connecting', direction, elapsedMs: 0, durationMs, peak, positions: emptyPositions, message: '正在等待 Player 确认马甲在线。' });
    void (async () => {
      try {
        await runner({
          ...pattern,
          signal: controller.signal,
          onReady: () => update({ phase: 'playing', message: '正在发送震动指令。' }),
          onFrame: (frame, elapsedMs) => update({
            elapsedMs: Math.round(elapsedMs),
            positions: Object.fromEntries(frame.Submit.map(({ Frame }) => [Frame.position, Frame.dotPoints])),
          }),
        });
        update({ phase: 'finished', elapsedMs: durationMs, positions: emptyPositions, message: '本轮震动指令已发送完毕。' });
      } catch (error) {
        const stopped = controller.signal.aborted;
        update({ phase: stopped ? 'stopped' : 'error', positions: emptyPositions, message: stopped ? '本轮试振已停止。' : error?.message ?? '试振中断。' });
      } finally {
        trial = null;
      }
    })();
  }

  const server = createServer(async (request, response) => {
    const host = `127.0.0.1:${request.socket.localPort}`;
    if (request.headers.host !== host) return reply(response, 403, { ok: false });
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', [workbenchHeader]: '1' });
      return response.end(page);
    }
    if (request.method === 'GET' && (request.url === '/arrangement.mjs' || request.url === '/waveform.mjs')) {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(request.url === '/arrangement.mjs' ? arrangementSource : waveformSource);
    }
    if (request.method === 'GET' && request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform' });
      subscribers.add(response);
      response.once('close', () => subscribers.delete(response));
      return sendSnapshot(response);
    }
    if (request.method === 'GET' && ['/design/preset/forward', '/design/preset/reverse'].includes(request.url)) {
      return reply(response, 200, previewDesign(request.url.endsWith('/reverse')));
    }
    if (request.method !== 'POST') return reply(response, 404, { ok: false });
    if (request.headers.origin !== `http://${host}`) return reply(response, 403, { ok: false, message: '请从本机观察器页面控制试振。' });
    if (request.url === '/stop') {
      trial?.abort();
      return reply(response, 200, { ok: true });
    }
    if (request.url === '/design/export' || request.url === '/play/design') {
      try {
        const design = await readDesign(request);
        if (request.url === '/design/export') {
          const source = standaloneSource(design, playbackSource, waveformSource);
          response.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Content-Disposition': 'attachment; filename="haptic-waveform.mjs"',
            'Cache-Control': 'no-store',
          });
          return response.end(source);
        }
        if (trial) return reply(response, 409, { ok: false, message: '一轮试振正在进行。' });
        startTrial('custom', design);
        return reply(response, 202, { ok: true });
      } catch (error) {
        return reply(response, 400, { ok: false, message: error.message });
      }
    }
    const direction = request.url === '/play/forward' ? 'forward' : request.url === '/play/reverse' ? 'reverse' : null;
    if (!direction) return reply(response, 404, { ok: false });
    if (trial) return reply(response, 409, { ok: false, message: '一轮试振正在进行。' });
    startTrial(direction);
    return reply(response, 202, { ok: true });
  });

  function close() {
    server.close();
    for (const response of subscribers) response.end();
    subscribers.clear();
    trial?.abort();
  }

  return { server, close };
}

function openWorkbench(port) {
  const url = `http://127.0.0.1:${port}/#designer`;
  console.log(`Haptic Waveform Workbench  ${url}`);
  if (process.platform === 'win32') {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('请在浏览器中打开上方地址。 / Open the address above in your browser.'));
    browser.unref();
  }
}

async function workbenchIsRunning(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    await response.body?.cancel();
    return response.ok && response.headers.get(workbenchHeader) === '1';
  } catch {
    return false;
  }
}

function runObserver() {
  if (typeof WebSocket !== 'function' || typeof Promise.withResolvers !== 'function') {
    console.error('请使用 Node.js 22 或更新版本。');
    process.exitCode = 1;
    return;
  }
  const { server, close } = createObserverServer();
  const port = Number(process.env.A_DRAG_OBSERVER_PORT ?? defaultObserverPort);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.once('error', async error => {
    if (error.code === 'EADDRINUSE' && await workbenchIsRunning(port)) {
      openWorkbench(port);
      return;
    }
    console.error(`工作台启动失败 / Failed to start the workbench. ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    openWorkbench(server.address().port);
    console.log('按 Ctrl+C 退出。 / Press Ctrl+C to quit.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runObserver();
