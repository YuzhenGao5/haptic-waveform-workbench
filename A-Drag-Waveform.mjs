const designPositions = Object.freeze(['VestBack', 'VestFront']);

function isDesignRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function skipWaveformTrivia(source, start) {
  const trivia = /(?:\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)*/y;
  trivia.lastIndex = start;
  trivia.exec(source);
  return trivia.lastIndex;
}

// Workbench exports lead with comments, static imports, then the JSON declaration.
// Reading the initializer as data keeps the playback code after it inert.
export function importWaveformSource(source) {
  if (typeof source !== 'string') throw new Error('导入源码必须是文本。');
  const moduleImport = /import\s+(?:(?:[\w$]+\s*,\s*)?(?:\{[^{}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+)?(?:'[^'\r\n]*'|"[^"\r\n]*")\s*;/y;
  let start = skipWaveformTrivia(source, 0);
  moduleImport.lastIndex = start;
  while (moduleImport.test(source)) {
    start = skipWaveformTrivia(source, moduleImport.lastIndex);
    moduleImport.lastIndex = start;
  }
  const declaration = /(?:export\s+)?const\s+waveform\s*=/y;
  declaration.lastIndex = start;
  if (!declaration.test(source)) throw new Error('没有找到波形数据。请选择工作台导出的 .mjs 文件。');
  start = skipWaveformTrivia(source, declaration.lastIndex);
  if (source[start] !== '{') throw new Error('waveform 需要直接包含 JSON 格式的波形数据。');

  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (character === '\\') index++;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      const end = index + 1;
      const separator = skipWaveformTrivia(source, end);
      if (separator < source.length && source[separator] !== ';') throw new Error('波形 JSON 对象后须为分号或文件结束。');
      let data;
      try { data = JSON.parse(source.slice(start, end)); }
      catch { throw new Error('波形数据的 JSON 格式无效。'); }
      return validateDesign(data);
    }
  }
  throw new Error('波形数据不完整，请重新导出 .mjs 文件。');
}

export function validateDesign(design) {
  if (!isDesignRecord(design) || design.version !== 1) throw new Error('触觉设计须使用版本 1。');
  if (!Array.isArray(design.clips) || design.clips.length < 1 || design.clips.length > 64) throw new Error('触觉设计需要 1 到 64 段片段。');

  const clips = Array.from(design.clips, (clip, index) => {
    const label = `第 ${index + 1} 段`;
    if (!isDesignRecord(clip)) throw new Error(`${label}须为对象。`);
    const { startMs, durationMs, interpolation } = clip;
    if (!Number.isInteger(startMs) || startMs < 0) throw new Error(`${label}的开始时间须为非负的整数毫秒。`);
    if (!Number.isInteger(durationMs) || durationMs < 50) throw new Error(`${label}的持续时间须为至少 50 的整数毫秒。`);
    if (startMs + durationMs > 120000) throw new Error(`${label}的结束时间不能超过 120 秒。`);
    if (interpolation !== 'linear' && interpolation !== 'cosine') throw new Error(`${label}须选择线性或余弦过渡。`);

    if (!isDesignRecord(clip.targets) || Object.keys(clip.targets).some(position => !designPositions.includes(position))) {
      throw new Error(`${label}的震点须位于胸甲前面或背面。`);
    }
    const targets = {};
    for (const position of designPositions) {
      const motors = clip.targets[position] === undefined ? [] : clip.targets[position];
      const face = position === 'VestFront' ? '前面' : '背面';
      if (!Array.isArray(motors)) throw new Error(`${label}的${face}震点须为数组。`);
      for (const motor of motors) {
        if (!Number.isInteger(motor) || motor < 0 || motor > 19) throw new Error(`${label}的${face}震点编号须为 0 到 19 的整数。`);
      }
      targets[position] = [...new Set(motors)].sort((left, right) => left - right);
    }
    if (targets.VestBack.length + targets.VestFront.length === 0) throw new Error(`${label}至少需要一个震点。`);

    if (!Array.isArray(clip.keyframes) || clip.keyframes.length < 2 || clip.keyframes.length > 64) {
      throw new Error(`${label}需要 2 到 64 个关键帧。`);
    }
    let previousTime = -1;
    const keyframes = Array.from(clip.keyframes, (frame, frameIndex) => {
      const frameLabel = `${label}第 ${frameIndex + 1} 个关键帧`;
      if (!isDesignRecord(frame)) throw new Error(`${frameLabel}须为对象。`);
      const { time, intensity } = frame;
      if (!Number.isFinite(time) || time < 0 || time > 1 || time <= previousTime) {
        throw new Error(`${frameLabel}的时间须在 0 到 1 之间，并且严格递增。`);
      }
      if (!Number.isFinite(intensity) || intensity < 0 || intensity > 100) {
        throw new Error(`${frameLabel}的强度须在 0 到 100 之间。`);
      }
      previousTime = time;
      return { time, intensity };
    });
    if (keyframes[0].time !== 0 || keyframes.at(-1).time !== 1) throw new Error(`${label}的首尾关键帧时间须分别为 0 和 1。`);
    return { startMs, durationMs, interpolation, targets, keyframes };
  });

  return { version: 1, clips };
}

export function designDurationMs(design) {
  return design.clips.reduce((latest, clip) => Math.max(latest, clip.startMs + clip.durationMs), 0);
}

export function designPeak(design) {
  let peak = 0;
  for (const clip of design.clips) {
    for (const frame of clip.keyframes) peak = Math.max(peak, frame.intensity);
  }
  return peak;
}

function designIntensityAt(clip, time) {
  const frames = clip.keyframes;
  for (let index = 1; index < frames.length; index++) {
    const end = frames[index];
    if (time > end.time) continue;
    const start = frames[index - 1];
    const progress = (time - start.time) / (end.time - start.time);
    const weight = clip.interpolation === 'cosine' ? (1 - Math.cos(Math.PI * progress)) / 2 : progress;
    return start.intensity + (end.intensity - start.intensity) * weight;
  }
  return frames.at(-1).intensity;
}

// Sample a validated design. Include both faces so their previous points can clear.
export function inspectDesignAt(design, elapsedMs) {
  const active = { VestBack: new Map(), VestFront: new Map() };
  const activeClips = [];
  if (Number.isFinite(elapsedMs)) {
    for (const [clipIndex, clip] of design.clips.entries()) {
      const clipElapsed = elapsedMs - clip.startMs;
      if (clipElapsed < 0 || clipElapsed >= clip.durationMs) continue;
      const intensity = Math.round(designIntensityAt(clip, clipElapsed / clip.durationMs));
      if (intensity === 0) continue;
      activeClips.push({ index: clipIndex, intensity });
      for (const position of designPositions) {
        for (const index of clip.targets[position]) {
          const face = active[position];
          const motor = face.get(index);
          if (motor) {
            motor.intensity = Math.max(motor.intensity, intensity);
            motor.clips.push(clipIndex);
          } else {
            face.set(index, { index, intensity, clips: [clipIndex] });
          }
        }
      }
    }
  }
  return { activeClips, positions: Object.fromEntries(designPositions.map(position => [position,
    [...active[position].values()].sort((left, right) => left.index - right.index),
  ])) };
}

export function sampleDesignFrame(design, elapsedMs, key) {
  const { positions } = inspectDesignAt(design, elapsedMs);
  return {
    Register: [],
    Submit: designPositions.map(position => ({
      type: 'frame', key: `${key}_${position}`,
      Frame: {
        durationMillis: 100, position, pathPoints: [],
        dotPoints: positions[position].map(({ index, intensity }) => ({ index, intensity })),
      },
    })),
  };
}
