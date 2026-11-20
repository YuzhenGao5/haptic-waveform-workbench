import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { playFrames } from './A-Drag-Player.mjs';
import { designDurationMs, sampleDesignFrame } from './A-Drag-Waveform.mjs';

export const previewPeak = 53;
const attackMs = 200;
const clipDurationMs = 1400;
const handoffMs = 800;

// Each path has its own start time and order on the Player's logical grid.
const paths = [
  { startMs: 0, points: [
    { position: 'VestBack', motors: [1, 2] },
    { position: 'VestBack', motors: [4, 7] },
    { position: 'VestFront', motors: [4, 7] },
    { position: 'VestFront', motors: [8, 11] },
    { position: 'VestFront', motors: [16, 19] },
  ] },
  { startMs: 400, points: [
    { position: 'VestFront', motors: [9] },
    { position: 'VestFront', motors: [5] },
    { position: 'VestBack', motors: [1] },
  ] },
];

function makePreset(reverse) {
  const clips = paths.flatMap(({ startMs, points }) => {
    const ordered = reverse ? points.toReversed() : points;
    return ordered.map(({ position, motors }, index) => ({
      startMs: startMs + index * handoffMs,
      durationMs: clipDurationMs,
      interpolation: 'cosine',
      targets: { VestFront: [], VestBack: [], [position]: motors },
      keyframes: [
        { time: 0, intensity: 0 },
        { time: attackMs / clipDurationMs, intensity: previewPeak },
        { time: 1, intensity: 0 },
      ],
    }));
  });
  return { version: 1, clips };
}

const forwardDesign = makePreset(false);
const reverseDesign = makePreset(true);
export const previewDurationMs = designDurationMs(forwardDesign);

export function previewDesign(reverse = false) {
  return structuredClone(reverse ? reverseDesign : forwardDesign);
}

export function sampleVestFrame(timeMs, key, reverse = false) {
  return sampleDesignFrame(reverse ? reverseDesign : forwardDesign, timeMs, key);
}

export function playPreview({ reverse = false, ...options } = {}) {
  return playFrames({
    ...options, durationMs: previewDurationMs,
    sampleFrame: (elapsedMs, key) => sampleVestFrame(elapsedMs, key, reverse),
  });
}

function runTerminal() {
  if (typeof WebSocket !== 'function' || typeof Promise.withResolvers !== 'function') {
    console.error('请使用 Node.js 22 或更新版本。');
    process.exitCode = 1;
    return;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let trial = null;
  console.log('A 拖尾波形 · 马甲试振');
  console.log(`请在 bHaptics Player 中连接马甲。每轮约 4.6 秒，峰值 ${previewPeak}%。`);
  console.log('Enter 正向  |  R + Enter 反向  |  S + Enter 停止  |  Q + Enter 退出');

  terminal.on('line', async line => {
    const command = line.trim().toLowerCase();
    if (command === 's') { trial?.abort(); return; }
    if (command === 'q') { terminal.close(); return; }
    if (command && command !== 'p' && command !== 'r') return;
    if (trial) { console.log('试振正在进行。'); return; }
    const reverse = command === 'r';
    trial = new AbortController();
    console.log('等待 Player 确认马甲在线…');
    try {
      await playPreview({ signal: trial.signal, reverse, onReady: () => console.log(reverse ? '正在反向播放…' : '正在正向播放…') });
      console.log('试振指令已发完，可以选择正向或反向再播。');
    } catch (error) {
      console.log(trial.signal.aborted ? '已停止。' : error.message);
    } finally {
      trial = null;
    }
  });
  terminal.on('SIGINT', () => terminal.close());
  terminal.on('close', () => trial?.abort());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runTerminal();
