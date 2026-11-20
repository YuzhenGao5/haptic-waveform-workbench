// Browser-only shared time/intensity graph. No network or device code.
const LIMIT_MS = 120000;
const SNAP_MS = 50;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const secondsLabel = ms => String(Number((ms / 1000).toFixed(3)));
const graphCopy = {
  'zh-CN': {
    peak: (wave, value) => `波 ${wave} · 峰值 ${value} ↕`,
    intensity: '强度', time: '播放时间（秒）', playhead: time => `游标 ${time}s`,
    legend: '曲线 ↔ 调时间    圆点 ↕ 调峰值    金带是时间重叠',
    invalid: '请先修正片段时间', empty: '暂无片段',
    peakHint: '上下拖动峰值，强度范围 0–100',
    waveHint: wave => `左右拖动波 ${wave} 调整开始时间`,
    scrubHint: '点击或拖动空白区域移动预览游标',
  },
  en: {
    peak: (wave, value) => `Wave ${wave} · Peak ${value} ↕`,
    intensity: 'Intensity', time: 'Time (s)', playhead: time => `Playhead ${time}s`,
    legend: 'Curve ↔ time    Handle ↕ peak    Gold band · overlap',
    invalid: 'Fix clip timing first', empty: 'No clips',
    peakHint: 'Drag up or down to set peak intensity (0–100).',
    waveHint: wave => `Drag wave ${wave} left or right to set its start time.`,
    scrubHint: 'Click or drag empty space to move the preview playhead.',
  },
};
const copyFor = locale => graphCopy[locale === 'en' ? 'en' : 'zh-CN'];

/** Stable, distinct curve/chip color; first eight presets use eight hues. */
export function arrangementColor(index) {
  const hue = (160 + Math.max(0, Math.floor(finite(index))) * 137.507764) % 360 / 60;
  const chroma = .65 * (1 - Math.abs(2 * .64 - 1));
  const second = chroma * (1 - Math.abs(hue % 2 - 1));
  const offset = .64 - chroma / 2;
  const rgb = hue < 1 ? [chroma, second, 0] : hue < 2 ? [second, chroma, 0]
    : hue < 3 ? [0, chroma, second] : hue < 4 ? [0, second, chroma]
      : hue < 5 ? [second, 0, chroma] : [chroma, 0, second];
  return `#${rgb.map(c => Math.round((c + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}
function niceStep(value) {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  const fraction = value / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}
function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * Shared seconds x intensity graph. Returns synchronous render().
 * Selected peak grip -> onStrength(index, integer 0..100).
 * Ordinary curve horizontal drag -> onMove(index, 50ms-snapped startMs).
 * Blank/axes -> onScrub(). Exact overlaps can be selected by caller chips.
 *
 * Inspect canvas.dataset.arrangementLayout (JSON, CSS pixels):
 * {width,height,plotBounds:{x,y,width,height},plotLeft,plotTop,plotWidth,
 *  plotHeight,timeMaxMs,overlapIntervals,clips:[{index,valid,color,selected,
 *  startMs,durationMs,peak,peakHandle:{x,y,radius,fraction},
 *  points:[{x,y,fraction,timeMs,intensity}]}]}.
 * Nine points per curve provide stable hit locations for automation.
 */
export function mountArrangement(canvas, { read, sampleEnvelope, onSelect, onMove, onScrub, onStrength } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function' || typeof read !== 'function') throw new TypeError('mountArrangement requires a canvas and read() callback.');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const envelope = typeof sampleEnvelope === 'function' ? sampleEnvelope : () => 0;
  const select = typeof onSelect === 'function' ? onSelect : () => {};
  const move = typeof onMove === 'function' ? onMove : () => {};
  const scrub = typeof onScrub === 'function' ? onScrub : () => {};
  const strengthen = typeof onStrength === 'function' ? onStrength : () => {};
  let layout = null, interaction = null, lastState = {}, hover = null;
  canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.touchAction = 'none';
  function getState() { try { return read() || {}; } catch { return {}; } }
  function valueAt(clip, t) { try { return clamp(finite(envelope(clip, clamp(t, 0, 1))), 0, 100); } catch { return 0; } }
  function coordinates(event) {
    if (!layout) return null;
    const r = canvas.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    return { x: (event.clientX - r.left) * layout.width / r.width, y: (event.clientY - r.top) * layout.height / r.height };
  }
  function insidePlot(p) {
    return p && layout && p.x >= layout.plotLeft - 8 && p.x <= layout.plotLeft + layout.plotWidth + 8
      && p.y >= layout.plotTop - 8 && p.y <= layout.plotTop + layout.plotHeight + 8;
  }
  function hitGrip(p, radius = 12) {
    const record = layout?.clips.find(c => c.selected && c.valid);
    return record && p && Math.hypot(p.x - record.peakHandle.x, p.y - record.peakHandle.y) <= radius ? record : null;
  }
  function nearestCurve(p, radius = 9) {
    if (!insidePlot(p)) return null;
    let nearest = null, distance = radius;
    for (const record of layout.clips) {
      if (!record.valid) continue;
      let next = Infinity;
      for (let i = 1; i < record.linePoints.length; i++) next = Math.min(next, segmentDistance(p, record.linePoints[i - 1], record.linePoints[i]));
      if (next < distance - .05 || next <= distance + .05 && record.selected && nearest) { nearest = record; distance = next; }
    }
    return nearest;
  }
  function release(pointerId) { try { if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId); } catch { /* Already released. */ } }
  function scrubAt(p, geometry = layout) {
    if (!p || !geometry) return;
    scrub(clamp(Math.round(clamp((p.x - geometry.plotLeft) / geometry.plotWidth, 0, 1) * geometry.timeMaxMs), 0, LIMIT_MS)); render();
  }
  function updateHoverTitle(copy) {
    if (!hover) return;
    canvas.title = hover.type === 'peak' ? copy.peakHint : hover.type === 'wave' ? copy.waveHint(hover.number) : copy.scrubHint;
  }
  function render() {
    const state = getState(); lastState = state;
    const copy = copyFor(state.locale);
    updateHoverTitle(copy);
    const clips = Array.isArray(state.clips) ? state.clips.slice(0, 64) : [];
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, finite(rect.width, canvas.clientWidth || 300) || canvas.clientWidth || 300);
    if (interaction && Math.abs(width - interaction.canvasWidth) > 1) {
      const pointerId = interaction.pointerId; interaction = null; release(pointerId);
    }
    const height = width < 420 ? 280 : 294;
    const plotLeft = Math.min(width - 1, width < 360 ? 38 : 45), plotTop = 32;
    const plotWidth = Math.max(1, width - plotLeft - Math.min(17, width * .04)), plotHeight = height - plotTop - 51;
    const playhead = clamp(finite(state.playheadMs), 0, LIMIT_MS);
    let maximumEnd = 0;
    const records = clips.map((clip, index) => {
      const start = clip?.startMs, duration = clip?.durationMs;
      const valid = Number.isFinite(start) && start >= 0 && Number.isFinite(duration) && duration >= SNAP_MS && duration <= LIMIT_MS && start + duration <= LIMIT_MS;
      const effectiveStart = interaction?.type === 'time' && interaction.index === index ? interaction.lastStartMs : start;
      if (valid) maximumEnd = Math.max(maximumEnd, effectiveStart + duration);
      return { index, clip, startMs: effectiveStart, durationMs: duration, valid, color: arrangementColor(index), selected: index === state.selectedIndex };
    });
    const extent = Math.max(maximumEnd, playhead), rounding = extent <= 5000 ? 500 : extent <= 20000 ? 1000 : 5000;
    const dynamicMax = Math.min(LIMIT_MS, Math.max(2000, Math.ceil(extent * 1.15 / rounding) * rounding));
    const timeMaxMs = interaction ? interaction.timeMaxMs : dynamicMax;
    const xAt = ms => plotLeft + ms / timeMaxMs * plotWidth, yAt = intensity => plotTop + (1 - intensity / 100) * plotHeight;
    const intersections = [];
    for (let a = 0; a < records.length; a++) {
      if (!records[a].valid) continue;
      for (let b = a + 1; b < records.length; b++) {
        if (!records[b].valid) continue;
        const start = Math.max(records[a].startMs, records[b].startMs);
        const end = Math.min(records[a].startMs + records[a].durationMs, records[b].startMs + records[b].durationMs);
        if (start < end) intersections.push([start, end]);
      }
    }
    const overlapIntervals = mergeIntervals(intersections);
    for (const record of records) {
      if (!record.valid) { record.linePoints = []; record.points = []; record.peak = 0; record.peakHandle = null; continue; }
      const steps = Math.min(400, Math.max(16, Math.ceil(record.durationMs / timeMaxMs * plotWidth / 2)));
      const fractions = new Set(Array.from({ length: steps + 1 }, (_, i) => i / steps)); fractions.add(.5);
      if (Array.isArray(record.clip?.keyframes)) for (const frame of record.clip.keyframes.slice(0, 64)) if (Number.isFinite(frame?.time) && frame.time >= 0 && frame.time <= 1) fractions.add(frame.time);
      const pointAt = fraction => {
        const intensity = valueAt(record.clip, fraction), timeMs = record.startMs + record.durationMs * fraction;
        return { x: xAt(timeMs), y: yAt(intensity), fraction, timeMs, intensity };
      };
      record.linePoints = [...fractions].sort((a, b) => a - b).map(pointAt);
      record.peak = Math.max(0, ...record.linePoints.map(p => p.intensity));
      const peak = record.linePoints.filter(p => Math.abs(p.intensity - record.peak) < 1e-6).sort((a, b) => Math.abs(a.fraction - .5) - Math.abs(b.fraction - .5))[0];
      record.peakHandle = { x: peak.x, y: peak.y, radius: 7, fraction: peak.fraction };
      record.points = Array.from({ length: 9 }, (_, i) => pointAt(i / 8));
    }
    canvas.style.height = `${height}px`;
    const ratio = clamp(finite(globalThis.window?.devicePixelRatio, 1), .5, 2);
    const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0d1620'; ctx.fillRect(0, 0, width, height);
    ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'middle';
    for (const intensity of [0, 25, 50, 75, 100]) {
      const y = yAt(intensity); ctx.strokeStyle = '#293b4c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plotLeft, y); ctx.lineTo(plotLeft + plotWidth, y); ctx.stroke();
      ctx.fillStyle = '#9bb2c6'; ctx.textAlign = 'right'; if (width > 55) ctx.fillText(String(intensity), plotLeft - 8, y);
    }
    const tickStep = niceStep(timeMaxMs / Math.max(2, Math.floor(plotWidth / 80)));
    for (let tick = 0, n = 0; tick <= timeMaxMs && n < 100; tick += tickStep, n++) {
      const x = xAt(tick); ctx.strokeStyle = '#203343'; ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, yAt(0) + 5); ctx.stroke();
      if (tick === 0 || x < plotLeft + plotWidth - 34) { ctx.fillStyle = '#93aabd'; ctx.textAlign = tick === 0 ? 'left' : 'center'; ctx.fillText(secondsLabel(tick), x + (tick === 0 ? 2 : 0), yAt(0) + 18); }
    }
    if (plotWidth > 35) { ctx.fillStyle = '#93aabd'; ctx.textAlign = 'right'; ctx.fillText(secondsLabel(timeMaxMs), plotLeft + plotWidth, yAt(0) + 18); }
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, plotTop, plotWidth, plotHeight); ctx.clip();
    ctx.fillStyle = '#d9ac61'; ctx.globalAlpha = .055;
    for (const [start, end] of overlapIntervals) ctx.fillRect(xAt(start), plotTop, xAt(end) - xAt(start), plotHeight);
    ctx.globalAlpha = 1;
    for (const record of [...records].sort((a, b) => Number(a.selected) - Number(b.selected))) {
      if (!record.valid) continue;
      const points = record.linePoints;
      const trace = () => { ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) ctx.lineTo(point.x, point.y); };
      ctx.beginPath(); ctx.moveTo(points[0].x, yAt(0)); for (const point of points) ctx.lineTo(point.x, point.y);
      ctx.lineTo(points.at(-1).x, yAt(0)); ctx.closePath(); ctx.fillStyle = record.color; ctx.globalAlpha = record.selected ? .18 : .09; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (record.selected) { trace(); ctx.strokeStyle = '#dcefff'; ctx.globalAlpha = .24; ctx.lineWidth = 6; ctx.stroke(); ctx.globalAlpha = 1; }
      trace(); ctx.strokeStyle = record.color; ctx.lineWidth = record.selected ? 2.8 : 1.6; ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, plotTop - 12, plotWidth, 6); ctx.clip(); ctx.fillStyle = '#d7ac64';
    for (const [start, end] of overlapIntervals) ctx.fillRect(xAt(start), plotTop - 11, Math.max(1, xAt(end) - xAt(start)), 4);
    ctx.restore();
    const headX = xAt(clamp(playhead, 0, timeMaxMs));
    ctx.strokeStyle = '#f0cf8a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(headX, plotTop - 4); ctx.lineTo(headX, yAt(0)); ctx.stroke();
    ctx.fillStyle = '#f0cf8a'; ctx.beginPath(); ctx.moveTo(headX - 4, plotTop - 7); ctx.lineTo(headX + 4, plotTop - 7); ctx.lineTo(headX, plotTop - 2); ctx.closePath(); ctx.fill();
    const selected = records.find(record => record.selected && record.valid);
    if (selected) {
      const handle = selected.peakHandle;
      ctx.fillStyle = '#0d1620'; ctx.strokeStyle = '#f3fbff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(handle.x, handle.y, handle.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = selected.color; ctx.beginPath(); ctx.arc(handle.x, handle.y, 3, 0, Math.PI * 2); ctx.fill();
      if (plotWidth > 160) {
        const label = copy.peak(selected.index + 1, Number(selected.peak.toFixed(1)));
        ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif'; ctx.textAlign = 'left';
        const labelWidth = Math.min(plotWidth - 6, ctx.measureText(label).width);
        const x = clamp(handle.x - labelWidth / 2, plotLeft + 3, plotLeft + plotWidth - labelWidth - 3);
        const y = handle.y < plotTop + 24 ? handle.y + 18 : handle.y - 15;
        ctx.strokeStyle = '#0d1620'; ctx.lineWidth = 4; ctx.strokeText(label, x, y, labelWidth); ctx.fillStyle = '#dfedf8'; ctx.fillText(label, x, y, labelWidth);
      }
    }
    if (plotWidth > 70) {
      const titleX = Math.max(3, plotLeft - 30), right = plotLeft + plotWidth;
      const playheadTime = secondsLabel(playhead), playheadLabel = copy.playhead(playheadTime);
      const topFits = ctx.measureText(copy.intensity).width + ctx.measureText(playheadLabel).width + 8 <= right - titleX;
      ctx.textAlign = 'left'; ctx.fillStyle = '#a0b7ca'; ctx.fillText(copy.intensity, titleX, 11);
      ctx.textAlign = 'right'; ctx.fillStyle = '#e8c98e'; ctx.fillText(topFits ? playheadLabel : `${playheadTime}s`, right, 10);
      ctx.fillStyle = '#92aabe'; ctx.fillText(copy.time, right, height - 11, plotWidth);
      if (plotWidth > 360 && ctx.measureText(copy.legend).width + ctx.measureText(copy.time).width + 16 <= plotWidth) {
        ctx.textAlign = 'left'; ctx.fillStyle = '#8099af'; ctx.fillText(copy.legend, plotLeft, height - 11);
      }
    }
    if (!records.some(r => r.valid) && plotWidth > 140) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#95aabf'; ctx.fillText(records.length ? copy.invalid : copy.empty, plotLeft + plotWidth / 2, plotTop + plotHeight / 2, plotWidth - 6);
    }
    layout = { width, height, plotLeft, plotTop, plotWidth, plotHeight, timeMaxMs, clips: records };
    canvas.dataset.arrangementLayout = JSON.stringify({ width, height, plotBounds: { x: plotLeft, y: plotTop, width: plotWidth, height: plotHeight }, plotLeft, plotTop, plotWidth, plotHeight, timeMaxMs, overlapIntervals,
      clips: records.map(({ index, valid, color, selected, startMs, durationMs, peak, peakHandle, points }) => ({ index, valid, color, selected, startMs: finite(startMs), durationMs: finite(durationMs), peak, peakHandle, points })) });
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const point = coordinates(event); if (!point || !layout) return;
    const grip = hitGrip(point, event.pointerType === 'touch' ? 17 : 12);
    const curve = grip || nearestCurve(point, event.pointerType === 'touch' ? 14 : 9);
    if (grip) {
      interaction = { type: 'strength', pointerId: event.pointerId, index: grip.index, startY: point.y, originalPeak: grip.peak, lastPeak: grip.peak, plotHeight: layout.plotHeight, timeMaxMs: layout.timeMaxMs, canvasWidth: layout.width, moved: false }; canvas.style.cursor = 'ns-resize';
    } else if (curve) {
      interaction = { type: 'time', pointerId: event.pointerId, index: curve.index, startX: point.x, startMs: curve.startMs, lastStartMs: curve.startMs, durationMs: curve.durationMs, timeMaxMs: layout.timeMaxMs, plotWidth: layout.plotWidth, canvasWidth: layout.width, moved: false };
      select(curve.index); canvas.style.cursor = 'ew-resize';
    } else {
      interaction = { type: 'scrub', pointerId: event.pointerId, timeMaxMs: layout.timeMaxMs, canvasWidth: layout.width, geometry: { plotLeft: layout.plotLeft, plotWidth: layout.plotWidth, timeMaxMs: layout.timeMaxMs } };
      scrubAt(point, interaction.geometry); canvas.style.cursor = 'crosshair';
    }
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic capture may fail. */ }
    event.preventDefault(); render();
  });
  canvas.addEventListener('pointermove', event => {
    const point = coordinates(event); if (!point) return;
    if (!interaction) {
      const grip = hitGrip(point, event.pointerType === 'touch' ? 17 : 12), curve = grip || nearestCurve(point);
      canvas.style.cursor = grip ? 'ns-resize' : curve ? 'ew-resize' : 'crosshair';
      hover = grip ? { type: 'peak' } : curve ? { type: 'wave', number: curve.index + 1 } : { type: 'scrub' };
      updateHoverTitle(copyFor(lastState.locale)); return;
    }
    if (event.pointerId !== interaction.pointerId) return;
    if (interaction.type === 'scrub') { scrubAt(point, interaction.geometry); return; }
    if (interaction.type === 'strength') {
      if (!interaction.moved && Math.abs(point.y - interaction.startY) < 2) return;
      interaction.moved = true;
      const peak = clamp(Math.round(interaction.originalPeak - (point.y - interaction.startY) / interaction.plotHeight * 100), 0, 100);
      if (peak !== interaction.lastPeak) { interaction.lastPeak = peak; strengthen(interaction.index, peak); render(); } return;
    }
    const delta = point.x - interaction.startX;
    if (!interaction.moved && Math.abs(delta) < 3) return;
    interaction.moved = true;
    const maximum = Math.max(0, Math.floor((LIMIT_MS - interaction.durationMs) / SNAP_MS) * SNAP_MS);
    const next = clamp(Math.round((interaction.startMs + delta / interaction.plotWidth * interaction.timeMaxMs) / SNAP_MS) * SNAP_MS, 0, maximum);
    if (next !== interaction.lastStartMs) { interaction.lastStartMs = next; move(interaction.index, next); render(); }
  });
  function endInteraction(event) {
    if (!interaction || event && event.pointerId !== interaction.pointerId) return;
    const pointerId = interaction.pointerId; interaction = null; canvas.style.cursor = 'crosshair'; release(pointerId); render();
  }
  canvas.addEventListener('pointerup', endInteraction); canvas.addEventListener('pointercancel', endInteraction); canvas.addEventListener('lostpointercapture', endInteraction);
  canvas.addEventListener('pointerleave', () => { hover = null; canvas.title = ''; });
  canvas.addEventListener('keydown', event => {
    const current = clamp(finite(lastState.playheadMs), 0, LIMIT_MS); let time;
    if (event.key === 'ArrowLeft') time = current - (event.shiftKey ? 1000 : SNAP_MS);
    else if (event.key === 'ArrowRight') time = current + (event.shiftKey ? 1000 : SNAP_MS);
    else if (event.key === 'Home') time = 0;
    else if (event.key === 'End') time = layout?.timeMaxMs || 0;
    else return;
    event.preventDefault(); scrub(clamp(Math.round(time), 0, LIMIT_MS)); render();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(render).observe(canvas);
  else globalThis.window?.addEventListener('resize', render);
  render(); return render;
}
