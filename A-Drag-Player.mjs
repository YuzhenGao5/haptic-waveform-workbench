import { randomUUID } from 'node:crypto';
import { setTimeout as playbackWait } from 'node:timers/promises';

const playerUrl = 'ws://127.0.0.1:15881/v2/feedbacks?app_id=a_drag_preview&app_name=A_Drag_Preview';
const playbackPositions = ['VestBack', 'VestFront'];
const playbackStepMs = 50;

function connectedPositions(data) {
  try {
    const status = JSON.parse(data);
    return Array.isArray(status?.ConnectedPositions) ? status.ConnectedPositions : null;
  } catch {
    return null;
  }
}

export async function playFrames({ durationMs, sampleFrame, signal, socketFactory = () => new WebSocket(playerUrl), onReady, onFrame }) {
  signal?.throwIfAborted();
  const connection = new AbortController();
  const playback = signal ? AbortSignal.any([signal, connection.signal]) : connection.signal;
  const key = `a_drag_preview_${randomUUID()}`;
  const socket = socketFactory();
  const ready = Promise.withResolvers();
  const fail = message => connection.abort(new Error(message));
  const timeout = setTimeout(() => fail('没有收到设备状态。请打开 bHaptics Player 后重试。'), 4000);
  let sentFrame = false;

  playback.addEventListener('abort', () => ready.reject(playback.reason), { once: true });
  socket.addEventListener('error', () => fail('无法连接 bHaptics Player。请先打开 Player。'));
  socket.addEventListener('close', () => fail('Player 已断开，请检查连接后重试。'));
  socket.addEventListener('message', event => {
    const connected = connectedPositions(event.data);
    if (!connected) return;
    if (connected.includes('Vest')) ready.resolve();
    else fail('Player 没有显示马甲已连接。请连接马甲后重试。');
  });

  try {
    await ready.promise;
    clearTimeout(timeout);
    playback.throwIfAborted();
    onReady?.();
    const startedAt = performance.now();
    let nextSampleAt = 0;
    for (;;) {
      playback.throwIfAborted();
      const elapsed = performance.now() - startedAt;
      if (elapsed >= durationMs) break;
      if (elapsed >= nextSampleAt) {
        const sampleAt = Math.min(elapsed + playbackStepMs / 2, durationMs - 0.001);
        const frame = sampleFrame(sampleAt, key);
        socket.send(JSON.stringify(frame));
        sentFrame = true;
        onFrame?.(frame, elapsed);
        // Resume at the next deadline if the event loop missed a sample.
        nextSampleAt = Math.min((Math.floor(elapsed / playbackStepMs) + 1) * playbackStepMs, durationMs);
      }
      const remaining = nextSampleAt - (performance.now() - startedAt);
      await playbackWait(Math.max(1, Math.ceil(remaining)), undefined, { signal: playback });
    }
  } catch (error) {
    if (playback.aborted) throw playback.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    if (socket.readyState === WebSocket.OPEN && sentFrame) {
      const Submit = playbackPositions.map(position => ({ type: 'turnOff', key: `${key}_${position}` }));
      try { socket.send(JSON.stringify({ Register: [], Submit })); }
      catch { /* The last frames expire after 100 ms if the socket disconnects. */ }
    }
    socket.close();
  }
}
