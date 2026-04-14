const CONFIG = {
  planeRadius: 16,
  clickPadding: 8,
  spawnMargin: 28,
  centralBias: 0.8,
  minSpawnSpacing: 60,
  minSpawnTimeGapMs: 320,
  minPathLength: 260,
  minOnScreenTimeSec: 2.3,
  safeConflictInsetRatio: 0.1,
  minReactionTimeSec: 1.15,
  roundPauseMs: 1000,
  countDownStepMs: 700,
  collisionPadding: 0,
  speedPxPerSec: {
    1: 85,
    2: 120,
    3: 155,
    4: 200,
    5: 250,
  },
  maxStaggerMs: 2200,
  spawnBatches: {
    easy: [0],
    medium: [0, 1200],
    random: [0, 700, 1500],
  },
  endlessCheckpoint: 6,
};

const state = {
  theme: 'night',
  mode: 'unlimited',
  maxPlanes: 5,
  speedLevel: 3,
  livesLimit: 5,
  roundsLimit: 6,
  mathEnabled: false,
  gridEnabled: true,
  screen: 'menu',
  running: false,
  waiting: false,
  currentRoundNumber: 0,
  currentSessionRoundCount: 0,
  totalCollisions: 0,
  deletedThisRound: 0,
  exitedThisRound: 0,
  overallDeleted: 0,
  overallExited: 0,
  overallPlanes: 0,
  roundResults: [],
  activePlanes: [],
  scheduledPlanes: [],
  spawnCounter: 0,
  roundPlan: null,
  lastTimestamp: 0,
  animationFrame: null,
  overlayLock: false,
  pendingContinue: false,
  sessionEnded: false,
  mathState: {
    active: false,
    cooldownUntil: 0,
    expireAt: 0,
    question: null,
    totalAsked: 0,
    correct: 0,
    wrong: 0,
    missed: 0,
  },
};

const els = {
  body: document.body,
  screens: {
    menu: document.getElementById('menuScreen'),
    game: document.getElementById('gameScreen'),
    continue: document.getElementById('continueScreen'),
    score: document.getElementById('scoreScreen'),
  },
  themeSelect: document.getElementById('themeSelect'),
  planeCountSelect: document.getElementById('planeCountSelect'),
  speedSelect: document.getElementById('speedSelect'),
  mathToggle: document.getElementById('mathToggle'),
  gridToggle: document.getElementById('gridToggle'),
  modeButtons: [...document.querySelectorAll('.mode-btn')],
  livesField: document.getElementById('livesField'),
  roundsField: document.getElementById('roundsField'),
  livesInput: document.getElementById('livesInput'),
  roundsInput: document.getElementById('roundsInput'),
  startGameBtn: document.getElementById('startGameBtn'),
  restartBtn: document.getElementById('restartBtn'),
  menuBtn: document.getElementById('menuBtn'),
  continueYesBtn: document.getElementById('continueYesBtn'),
  continueNoBtn: document.getElementById('continueNoBtn'),
  playAgainBtn: document.getElementById('playAgainBtn'),
  scoreMenuBtn: document.getElementById('scoreMenuBtn'),
  canvas: document.getElementById('gameCanvas'),
  gameAreaWrap: document.getElementById('gameAreaWrap'),
  overlayMessage: document.getElementById('overlayMessage'),
  roundStat: document.getElementById('roundStat'),
  collisionStat: document.getElementById('collisionStat'),
  deletedStat: document.getElementById('deletedStat'),
  exitedStat: document.getElementById('exitedStat'),
  scoreTableBody: document.querySelector('#scoreTable tbody'),
  scoreMeta: document.getElementById('scoreMeta'),
  mathQuestionWrap: document.getElementById('mathQuestionWrap'),
  mathQuestionPrompt: document.getElementById('mathQuestionPrompt'),
  mathAnswers: document.getElementById('mathAnswers'),
};

const ctx = els.canvas.getContext('2d');

function applyTheme(theme) {
  state.theme = theme;
  els.body.classList.toggle('theme-day', theme === 'day');
  els.body.classList.toggle('theme-night', theme !== 'day');
}

function switchScreen(name) {
  state.screen = name;
  Object.entries(els.screens).forEach(([key, screen]) => {
    screen.classList.toggle('active', key === name);
  });
}

function syncMenuVisibility() {
  els.modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  });
  els.livesField.classList.toggle('hidden', state.mode !== 'lives');
  els.roundsField.classList.toggle('hidden', state.mode !== 'rounds');
}

function resizeCanvas() {
  const rect = els.gameAreaWrap.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  els.canvas.width = Math.floor(rect.width * ratio);
  els.canvas.height = Math.floor(rect.height * ratio);
  els.canvas.style.width = `${rect.width}px`;
  els.canvas.style.height = `${rect.height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  render();
}

function getCanvasSize() {
  return {
    width: els.gameAreaWrap.clientWidth,
    height: els.gameAreaWrap.clientHeight,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sideOfPoint(point, width, height) {
  const margin = 2;
  if (point.x <= margin) return 'left';
  if (point.x >= width - margin) return 'right';
  if (point.y <= margin) return 'top';
  if (point.y >= height - margin) return 'bottom';
  return 'unknown';
}

function randomEdgePoint(side, width, height) {
  const margin = CONFIG.spawnMargin;
  if (side === 'top') return { x: randFloat(margin, width - margin), y: 0 };
  if (side === 'bottom') return { x: randFloat(margin, width - margin), y: height };
  if (side === 'left') return { x: 0, y: randFloat(margin, height - margin) };
  return { x: width, y: randFloat(margin, height - margin) };
}

function randomBiasedEdgePoint(side, width, height) {
  const margin = CONFIG.spawnMargin;
  const centralBias = CONFIG.centralBias;
  if (side === 'top' || side === 'bottom') {
    const usable = width - margin * 2;
    const pad = usable * ((1 - centralBias) / 2);
    return {
      x: randFloat(margin + pad, width - margin - pad),
      y: side === 'top' ? 0 : height,
    };
  }
  const usable = height - margin * 2;
  const pad = usable * ((1 - centralBias) / 2);
  return {
    x: side === 'left' ? 0 : width,
    y: randFloat(margin + pad, height - margin - pad),
  };
}

function pickEndSide(startSide) {
  const map = {
    top: ['left', 'right', 'bottom', 'top'],
    bottom: ['left', 'right', 'top', 'bottom'],
    left: ['top', 'bottom', 'right', 'left'],
    right: ['top', 'bottom', 'left', 'right'],
  };
  const pool = Math.random() < 0.24 ? map[startSide] : map[startSide].filter((side) => side !== startSide);
  return pool[randInt(0, pool.length - 1)];
}

function pathHasEnoughTravel(length, speed) {
  return length >= CONFIG.minPathLength && (length / speed) >= CONFIG.minOnScreenTimeSec;
}

function getMinimumRoundPlaneCount() {
  return state.maxPlanes >= 5 ? 3 : 2;
}

function pointInCentralSafeZone(point, width, height) {
  const insetX = width * CONFIG.safeConflictInsetRatio;
  const insetY = height * CONFIG.safeConflictInsetRatio;
  return point.x >= insetX && point.x <= width - insetX && point.y >= insetY && point.y <= height - insetY;
}

function lineIntersectsInnerPlayArea(start, end, width, height) {
  const minX = width * CONFIG.safeConflictInsetRatio;
  const maxX = width - minX;
  const minY = height * CONFIG.safeConflictInsetRatio;
  const maxY = height - minY;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  let t0 = 0;
  let t1 = 1;

  function clip(p, q) {
    if (Math.abs(p) < 0.000001) return q >= 0;
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return false;
      if (ratio > t0) t0 = ratio;
      return true;
    }
    if (ratio < t0) return false;
    if (ratio < t1) t1 = ratio;
    return true;
  }

  return clip(-dx, start.x - minX)
    && clip(dx, maxX - start.x)
    && clip(-dy, start.y - minY)
    && clip(dy, maxY - start.y)
    && t0 <= t1;
}

function classifyPlaneTrajectory(definition) {
  const dx = definition.end.x - definition.start.x;
  const dy = definition.end.y - definition.start.y;
  return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

function hasRequiredTrajectoryMix(definitions) {
  let hasHorizontal = false;
  let hasVertical = false;

  definitions.forEach((definition) => {
    if (classifyPlaneTrajectory(definition) === 'horizontal') {
      hasHorizontal = true;
    } else {
      hasVertical = true;
    }
  });

  return hasHorizontal && hasVertical;
}

function spawnConflictsWithExisting(definition, definitions) {
  return definitions.some((other) => {
    const timeGap = Math.abs(definition.delayMs - other.delayMs);
    if (timeGap > CONFIG.minSpawnTimeGapMs) return false;
    const spacingThreshold = CONFIG.minSpawnSpacing + Math.max(0, (CONFIG.minSpawnTimeGapMs - timeGap) * 0.06);
    return distance(definition.start, other.start) < spacingThreshold;
  });
}

function interactionIsFair(hit, defA, defB, width, height) {
  if (!pointInCentralSafeZone(hit.point, width, height)) return false;
  const afterSpawnA = hit.timeA - (defA.delayMs / 1000);
  const afterSpawnB = hit.timeB - (defB.delayMs / 1000);
  return afterSpawnA >= CONFIG.minReactionTimeSec && afterSpawnB >= CONFIG.minReactionTimeSec;
}

function hasUnfairInteraction(definitions, width, height) {
  for (let i = 0; i < definitions.length; i += 1) {
    for (let j = i + 1; j < definitions.length; j += 1) {
      const hit = linesTouch(definitions[i], definitions[j], definitions[i].radius + definitions[j].radius + CONFIG.collisionPadding);
      if (hit && !interactionIsFair(hit, definitions[i], definitions[j], width, height)) {
        return true;
      }
    }
  }
  return false;
}

function countRecentZeroConflictRounds() {
  let count = 0;
  for (let i = state.roundResults.length - 1; i >= 0; i -= 1) {
    if (state.roundResults[i].minimumDeletions !== 0) break;
    count += 1;
  }
  return count;
}

function makePlaneDefinition(index, delayMs, speedScale, width, height) {
  const sides = shuffle(['top', 'right', 'bottom', 'left']);
  for (let tries = 0; tries < 100; tries += 1) {
    const startSide = sides[tries % sides.length];
    const endSide = pickEndSide(startSide);
    const start = randomBiasedEdgePoint(startSide, width, height);
    const end = endSide === startSide ? randomEdgePoint(endSide, width, height) : randomBiasedEdgePoint(endSide, width, height);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const speed = CONFIG.speedPxPerSec[state.speedLevel] * speedScale;
    if (!pathHasEnoughTravel(length, speed)) continue;
    if (!lineIntersectsInnerPlayArea(start, end, width, height)) continue;

    const dirX = dx / length;
    const dirY = dy / length;

    return {
      id: `r${state.currentRoundNumber}-p${index}`,
      order: index,
      start,
      end,
      startSide,
      endSide,
      dirX,
      dirY,
      length,
      speed,
      delayMs,
      radius: CONFIG.planeRadius,
    };
  }
  return null;
}

function linesTouch(defA, defB, radiusSum) {
  const p = defA.start;
  const r = { x: defA.end.x - defA.start.x, y: defA.end.y - defA.start.y };
  const q = defB.start;
  const s = { x: defB.end.x - defB.start.x, y: defB.end.y - defB.start.y };
  const denom = r.x * s.y - r.y * s.x;

  if (Math.abs(denom) < 0.0001) {
    return null;
  }

  const qp = { x: q.x - p.x, y: q.y - p.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  const intersection = {
    x: p.x + t * r.x,
    y: p.y + t * r.y,
  };

  const timeA = defA.delayMs / 1000 + (defA.length * t) / defA.speed;
  const timeB = defB.delayMs / 1000 + (defB.length * u) / defB.speed;
  const tolerance = radiusSum / Math.min(defA.speed, defB.speed);

  if (Math.abs(timeA - timeB) <= tolerance) {
    return { timeA, timeB, point: intersection };
  }

  return null;
}

function buildConflictGraph(definitions) {
  const { width, height } = getCanvasSize();
  const graph = new Map();
  definitions.forEach((plane) => graph.set(plane.id, new Set()));
  for (let i = 0; i < definitions.length; i += 1) {
    for (let j = i + 1; j < definitions.length; j += 1) {
      const hit = linesTouch(definitions[i], definitions[j], definitions[i].radius + definitions[j].radius + CONFIG.collisionPadding);
      if (hit && interactionIsFair(hit, definitions[i], definitions[j], width, height)) {
        graph.get(definitions[i].id).add(definitions[j].id);
        graph.get(definitions[j].id).add(definitions[i].id);
      }
    }
  }
  return graph;
}

function exactMinimumDeletions(conflictGraph) {
  const nodes = [...conflictGraph.keys()];
  const edges = [];
  nodes.forEach((a) => {
    conflictGraph.get(a).forEach((b) => {
      if (a < b) edges.push([a, b]);
    });
  });

  function recurse(remainingEdges, chosen) {
    if (remainingEdges.length === 0) return chosen;
    if (chosen.length >= best.length) return best;

    const [a, b] = remainingEdges[0];
    const withA = recurse(remainingEdges.filter(([x, y]) => x !== a && y !== a), [...chosen, a]);
    if (withA.length < best.length) best = withA;
    const withB = recurse(remainingEdges.filter(([x, y]) => x !== b && y !== b), [...chosen, b]);
    if (withB.length < best.length) best = withB;
    return best;
  }

  let best = [...nodes];
  recurse(edges, []);
  return { count: best.length, set: new Set(best) };
}

function hasSpawnSpacingIssues(definitions) {
  for (let i = 0; i < definitions.length; i += 1) {
    if (spawnConflictsWithExisting(definitions[i], definitions.slice(i + 1))) return true;
  }
  return false;
}

function countImmediateSpawnCollisions(definitions) {
  let immediate = 0;
  for (let i = 0; i < definitions.length; i += 1) {
    for (let j = i + 1; j < definitions.length; j += 1) {
      if (Math.abs(definitions[i].delayMs - definitions[j].delayMs) <= 100) {
        const dist = distance(definitions[i].start, definitions[j].start);
        if (dist <= definitions[i].radius + definitions[j].radius + 4) {
          immediate += 1;
        }
      }
    }
  }
  return immediate;
}

function planRoundDifficulty(roundNumber) {
  if (roundNumber === 1) return 'easy';
  if (roundNumber === 2) return 'rising';
  return 'random';
}

function getRoundPlaneCount(roundNumber) {
  const minPlanes = getMinimumRoundPlaneCount();
  if (roundNumber === 1) return Math.min(state.maxPlanes, Math.max(2, state.maxPlanes - 2));
  if (roundNumber === 2) return Math.min(state.maxPlanes, Math.max(minPlanes, state.maxPlanes - 1));
  return randInt(minPlanes, state.maxPlanes);
}

function getSpawnSchedule(planeCount, difficultyLabel) {
  if (planeCount <= 2) return [0, 0].slice(0, planeCount);
  if (difficultyLabel === 'easy') {
    const base = [0, 700, 1350, 1850, 2200, 2550, 2850];
    return base.slice(0, planeCount);
  }
  if (difficultyLabel === 'rising') {
    const base = [0, 450, 950, 1300, 1650, 2000, 2350];
    return base.slice(0, planeCount);
  }
  const schedule = [];
  let t = 0;
  for (let i = 0; i < planeCount; i += 1) {
    if (i === 0) {
      schedule.push(0);
    } else {
      t += randInt(240, 860);
      schedule.push(Math.min(t, CONFIG.maxStaggerMs));
    }
  }
  if (Math.random() < 0.35 && planeCount >= 3) {
    schedule[1] = 0;
  }
  if (Math.random() < 0.22 && planeCount >= 4) {
    schedule[2] = 0;
  }
  return schedule.sort((a, b) => a - b);
}

function generateRoundPlan(roundNumber) {
  const { width, height } = getCanvasSize();
  const difficultyLabel = planRoundDifficulty(roundNumber);
  const planeCount = getRoundPlaneCount(roundNumber);
  const minimumPlaneCount = getMinimumRoundPlaneCount();
  const zeroConflictStreak = countRecentZeroConflictRounds();
  const shouldPreferConflict = roundNumber > 2 && zeroConflictStreak < 2 && Math.random() < 0.78;

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const schedule = getSpawnSchedule(planeCount, difficultyLabel);
    const definitions = [];

    for (let i = 0; i < planeCount; i += 1) {
      const speedScale = randFloat(0.85, 1.15);
      const plane = makePlaneDefinition(i + 1, schedule[i], speedScale, width, height);
      if (!plane) break;
      if (spawnConflictsWithExisting(plane, definitions)) break;
      definitions.push(plane);
    }

    if (definitions.length !== planeCount) continue;
    if (planeCount > 3 && !hasRequiredTrajectoryMix(definitions)) continue;
    if (hasSpawnSpacingIssues(definitions)) continue;
    if (countImmediateSpawnCollisions(definitions) > 0) continue;
    if (hasUnfairInteraction(definitions, width, height)) continue;

    const graph = buildConflictGraph(definitions);
    const optimum = exactMinimumDeletions(graph);
    const conflictCount = [...graph.values()].reduce((sum, set) => sum + set.size, 0) / 2;

    if (zeroConflictStreak >= 2 && optimum.count === 0) continue;
    if (shouldPreferConflict && optimum.count === 0) continue;

    if (difficultyLabel === 'easy' && optimum.count > Math.max(1, Math.floor(planeCount / 2))) continue;
    if (difficultyLabel === 'rising' && conflictCount === 0) continue;
    if (difficultyLabel !== 'easy' && conflictCount === 0 && Math.random() < 0.45) continue;

    return {
      planeCount,
      definitions,
      conflictGraph: graph,
      minimumDeletions: optimum.count,
      optimumSet: optimum.set,
      difficultyLabel,
    };
  }

  const fallbackCount = Math.min(state.maxPlanes, minimumPlaneCount);
  const definitions = [];
  for (let i = 0; i < fallbackCount; i += 1) {
    const plane = makePlaneDefinition(i + 1, i * 900, 1, width, height);
    if (!plane) break;
    definitions.push(plane);
  }
  const graph = buildConflictGraph(definitions);
  const optimum = exactMinimumDeletions(graph);
  return {
    planeCount: definitions.length,
    definitions,
    conflictGraph: graph,
    minimumDeletions: optimum.count,
    optimumSet: optimum.set,
    difficultyLabel: 'easy',
  };
}

function clonePlaneRuntime(def) {
  return {
    ...def,
    x: def.start.x,
    y: def.start.y,
    active: true,
    spawned: false,
    elapsedSinceSpawn: 0,
    exitTime: def.length / def.speed,
  };
}

function prepareRound(roundNumber) {
  state.currentRoundNumber = roundNumber;
  state.deletedThisRound = 0;
  state.exitedThisRound = 0;
  state.spawnCounter = 0;
  state.activePlanes = [];
  state.roundPlan = generateRoundPlan(roundNumber);
  state.scheduledPlanes = state.roundPlan.definitions.map(clonePlaneRuntime);
  updateStats();
  resetMathRoundMessage();
}

function showOverlay(text, hidden = false) {
  els.overlayMessage.textContent = text;
  els.overlayMessage.classList.toggle('hidden', hidden);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runCountdown() {
  state.overlayLock = true;
  const steps = ['3', '2', '1', 'GO'];
  for (const step of steps) {
    showOverlay(step, false);
    await delay(CONFIG.countDownStepMs);
  }
  showOverlay('', true);
  state.overlayLock = false;
}

function startLoop() {
  cancelLoop();
  state.running = true;
  state.lastTimestamp = performance.now();
  state.animationFrame = requestAnimationFrame(loop);
}

function cancelLoop() {
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  state.running = false;
}

function spawnScheduledPlanes(nowMs) {
  const spawnable = state.scheduledPlanes.filter((plane) => !plane.spawned && plane.delayMs <= nowMs);
  spawnable.forEach((plane) => {
    plane.spawned = true;
    state.activePlanes.push(plane);
    state.spawnCounter += 1;
  });
}

function removePlaneById(id, reason) {
  const index = state.activePlanes.findIndex((plane) => plane.id === id);
  if (index === -1) return;
  const [plane] = state.activePlanes.splice(index, 1);
  plane.active = false;
  if (reason === 'deleted') {
    state.deletedThisRound += 1;
    state.overallDeleted += 1;
  }
  if (reason === 'exited') {
    state.exitedThisRound += 1;
    state.overallExited += 1;
  }
}

function processCollisions() {
  const collided = new Set();
  for (let i = 0; i < state.activePlanes.length; i += 1) {
    for (let j = i + 1; j < state.activePlanes.length; j += 1) {
      const a = state.activePlanes[i];
      const b = state.activePlanes[j];
      if (distance(a, b) <= a.radius + b.radius) {
        collided.add(a.id);
        collided.add(b.id);
      }
    }
  }
  if (collided.size > 0) {
    const pairCount = collided.size / 2;
    state.totalCollisions += pairCount;
    [...collided].forEach((id) => removePlaneById(id, 'collision'));
    if (state.mode === 'lives' && state.totalCollisions >= state.livesLimit) {
      finalizeRound(true);
      return true;
    }
  }
  return false;
}

function allRoundPlanesResolved() {
  const remainingScheduled = state.scheduledPlanes.some((plane) => !plane.spawned);
  return !remainingScheduled && state.activePlanes.length === 0;
}

function updatePlanePositions(deltaSec) {
  state.activePlanes.forEach((plane) => {
    plane.elapsedSinceSpawn += deltaSec;
    const progress = clamp(plane.elapsedSinceSpawn / plane.exitTime, 0, 1);
    plane.x = plane.start.x + (plane.end.x - plane.start.x) * progress;
    plane.y = plane.start.y + (plane.end.y - plane.start.y) * progress;
  });

  const exited = state.activePlanes.filter((plane) => plane.elapsedSinceSpawn >= plane.exitTime);
  exited.forEach((plane) => removePlaneById(plane.id, 'exited'));
}

function scoreRound(result) {
  if (result.collisions === 0 && result.deleted === result.minimumDeletions) return 10;

  let score = 10;
  if (result.collisions > 0) score -= result.collisions * 3;
  const deletePenalty = Math.max(0, result.deleted - result.minimumDeletions) * 1.25;
  const underDeletePenalty = result.collisions > 0 && result.deleted < result.minimumDeletions ? (result.minimumDeletions - result.deleted) * 0.75 : 0;
  score -= deletePenalty + underDeletePenalty;
  return Number(clamp(score, 0, 10).toFixed(1));
}

function finalizeRound(immediateFailure = false) {
  if (!state.roundPlan) return;

  const result = {
    round: state.currentRoundNumber,
    totalPlanes: state.roundPlan.planeCount,
    deleted: state.deletedThisRound,
    minimumDeletions: state.roundPlan.minimumDeletions,
    collisions: state.totalCollisions - state.roundResults.reduce((sum, item) => sum + item.collisions, 0),
    exited: state.exitedThisRound,
  };
  result.rankScore = scoreRound(result);
  state.roundResults.push(result);
  state.overallPlanes += result.totalPlanes;
  state.currentSessionRoundCount += 1;
  state.roundPlan = null;
  state.activePlanes = [];
  state.scheduledPlanes = [];
  updateStats();

  if (immediateFailure) {
    endGame('Lives limit reached.');
    return;
  }

  if (state.mode === 'rounds' && state.currentRoundNumber >= state.roundsLimit) {
    endGame('Selected round count completed.');
    return;
  }

  if (state.mode === 'unlimited' && state.currentSessionRoundCount % CONFIG.endlessCheckpoint === 0) {
    pauseForContinue();
    return;
  }

  scheduleNextRound();
}

async function scheduleNextRound() {
  state.waiting = true;
  showOverlay('', true);
  await delay(CONFIG.roundPauseMs);
  state.waiting = false;
  if (state.screen !== 'game') return;
  prepareRound(state.currentRoundNumber + 1);
}

function pauseForContinue() {
  cancelLoop();
  switchScreen('continue');
}

async function continueUnlimited() {
  switchScreen('game');
  await runCountdown();
  prepareRound(state.currentRoundNumber + 1);
  startLoop();
}

function buildOverallScore() {
  if (state.roundResults.length === 0) return 0;
  const average = state.roundResults.reduce((sum, item) => sum + item.rankScore, 0) / state.roundResults.length;
  return Number(average.toFixed(1));
}

function renderScoreboard(reasonText) {
  els.scoreTableBody.innerHTML = '';
  const overallRow = document.createElement('tr');
  overallRow.innerHTML = `
    <td><strong>Overall</strong></td>
    <td>${state.overallPlanes}</td>
    <td>${state.overallDeleted}</td>
    <td>${state.roundResults.reduce((sum, r) => sum + r.minimumDeletions, 0)}</td>
    <td>${state.totalCollisions}</td>
    <td><strong>${buildOverallScore().toFixed(1)}</strong></td>
  `;
  els.scoreTableBody.appendChild(overallRow);

  state.roundResults.forEach((result) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>Round ${result.round}</td>
      <td>${result.totalPlanes}</td>
      <td>${result.deleted}</td>
      <td>${result.minimumDeletions}</td>
      <td>${result.collisions}</td>
      <td>${result.rankScore.toFixed(1)}</td>
    `;
    els.scoreTableBody.appendChild(row);
  });

  els.scoreMeta.textContent = `${reasonText} Total collisions: ${state.totalCollisions}. Maths asked: ${state.mathState.totalAsked}. Correct: ${state.mathState.correct}. Missed: ${state.mathState.missed}.`;
}

function endGame(reasonText) {
  cancelLoop();
  state.sessionEnded = true;
  renderScoreboard(reasonText);
  switchScreen('score');
}

function updateStats() {
  els.roundStat.textContent = String(state.currentRoundNumber);
  els.collisionStat.textContent = String(state.totalCollisions);
  els.deletedStat.textContent = String(state.deletedThisRound);
  els.exitedStat.textContent = String(state.exitedThisRound);
}

function drawGrid(width, height) {
  if (!state.gridEnabled) return;
  ctx.save();
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid').trim();
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlanes() {
  const styles = getComputedStyle(document.body);
  const fill = styles.getPropertyValue('--plane-fill').trim();
  const stroke = styles.getPropertyValue('--plane-stroke').trim();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 12px Inter, Arial, sans-serif';
  state.activePlanes.forEach((plane) => {
    ctx.beginPath();
    ctx.arc(plane.x, plane.y, plane.radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stroke;
    ctx.fillText(String(plane.order), plane.x, plane.y + 0.5);
  });
  ctx.restore();
}

function render() {
  const { width, height } = getCanvasSize();
  ctx.clearRect(0, 0, width, height);
  drawGrid(width, height);
  drawPlanes();
}

function maybeSpawnMathQuestion(nowMs) {
  if (!state.mathEnabled || state.mathState.active || nowMs < state.mathState.cooldownUntil) return;
  if (Math.random() > 0.007) return;

  const question = generateMathQuestion();
  state.mathState.active = true;
  state.mathState.question = question;
  state.mathState.expireAt = nowMs + 5000;
  state.mathState.totalAsked += 1;
  els.mathQuestionWrap.classList.remove('inactive');
  els.mathQuestionPrompt.textContent = question.prompt;
  els.mathAnswers.innerHTML = question.answers.map((answer, idx) => {
    const key = ['A', 'S', 'D', 'F'][idx];
    return `<div class="answer-chip">${key}: ${answer}</div>`;
  }).join('');
}

function resetMathRoundMessage() {
  if (!state.mathEnabled) {
    els.mathQuestionWrap.classList.add('inactive');
    els.mathQuestionPrompt.textContent = 'Maths overlay is off.';
    els.mathAnswers.innerHTML = '';
    return;
  }
  if (!state.mathState.active) {
    els.mathQuestionWrap.classList.add('inactive');
    els.mathQuestionPrompt.textContent = 'Maths overlay is on. Questions appear at random times.';
    els.mathAnswers.innerHTML = '';
  }
}

function expireMathQuestion(nowMs) {
  if (!state.mathState.active) return;
  if (nowMs < state.mathState.expireAt) return;
  state.mathState.active = false;
  state.mathState.question = null;
  state.mathState.cooldownUntil = nowMs + 5000;
  state.mathState.missed += 1;
  resetMathRoundMessage();
}

function generateMathQuestion() {
  const types = ['add', 'subtract', 'multiply', 'divide'];
  const type = types[randInt(0, types.length - 1)];
  let prompt = '';
  let correct = 0;

  if (type === 'add') {
    const a = randInt(10, 9999);
    const b = randInt(10, 9999);
    prompt = `${a} + ${b} = ?`;
    correct = a + b;
  } else if (type === 'subtract') {
    const a = randInt(100, 9999);
    const b = randInt(10, a - 1);
    prompt = `${a} − ${b} = ?`;
    correct = a - b;
  } else if (type === 'multiply') {
    const a = randInt(2, 999);
    const b = randInt(2, 99);
    prompt = `${a} × ${b} = ?`;
    correct = a * b;
  } else {
    const divisor = randInt(2, 99);
    const quotient = randInt(2, 50);
    const dividend = divisor * quotient;
    prompt = `${dividend} ÷ ${divisor} = ?`;
    correct = quotient;
  }

  const options = new Set([correct]);
  while (options.size < 4) {
    const drift = randInt(-25, 25) || 7;
    const candidate = Math.max(0, correct + drift + randInt(-10, 10));
    options.add(candidate);
  }

  const answers = shuffle([...options]);
  const correctIndex = answers.indexOf(correct);
  return { prompt, answers, correctIndex, correct };
}

function handleMathAnswer(key, nowMs) {
  if (!state.mathState.active) return false;
  const map = { a: 0, s: 1, d: 2, f: 3 };
  const idx = map[key.toLowerCase()];
  if (idx === undefined) return false;

  if (idx === state.mathState.question.correctIndex) {
    state.mathState.correct += 1;
  } else {
    state.mathState.wrong += 1;
  }
  state.mathState.active = false;
  state.mathState.question = null;
  state.mathState.cooldownUntil = nowMs + 5000;
  resetMathRoundMessage();
  return true;
}

function loop(timestamp) {
  const deltaSec = Math.min((timestamp - state.lastTimestamp) / 1000, 0.05);
  state.lastTimestamp = timestamp;

  if (state.screen !== 'game') return;
  if (!state.waiting && !state.overlayLock && state.roundPlan) {
    const roundElapsedMs = timestamp - (state.roundStartTimestamp || timestamp);
    if (!state.roundStartTimestamp) state.roundStartTimestamp = timestamp;
    spawnScheduledPlanes(roundElapsedMs);
    updatePlanePositions(deltaSec);
    if (processCollisions()) return;
    maybeSpawnMathQuestion(timestamp);
    expireMathQuestion(timestamp);
    if (allRoundPlanesResolved()) {
      state.roundStartTimestamp = null;
      finalizeRound(false);
      if (!state.sessionEnded) startLoop();
      return;
    }
  }

  updateStats();
  render();
  state.animationFrame = requestAnimationFrame(loop);
}

function pointInsidePlane(point, plane) {
  return distance(point, plane) <= plane.radius + CONFIG.clickPadding;
}

function handleCanvasClick(event) {
  if (state.screen !== 'game' || !state.roundPlan) return;
  const rect = els.canvas.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };

  for (let i = state.activePlanes.length - 1; i >= 0; i -= 1) {
    const plane = state.activePlanes[i];
    if (pointInsidePlane(point, plane)) {
      removePlaneById(plane.id, 'deleted');
      updateStats();
      render();
      break;
    }
  }
}

function readMenuSettings() {
  state.maxPlanes = Number(els.planeCountSelect.value);
  state.speedLevel = Number(els.speedSelect.value);
  state.livesLimit = clamp(Number(els.livesInput.value) || 5, 1, 20);
  state.roundsLimit = clamp(Number(els.roundsInput.value) || 6, 3, 15);
  state.mathEnabled = els.mathToggle.checked;
  state.gridEnabled = els.gridToggle.checked;
  applyTheme(els.themeSelect.value);
}

function resetSession() {
  cancelLoop();
  state.running = false;
  state.waiting = false;
  state.currentRoundNumber = 0;
  state.currentSessionRoundCount = 0;
  state.totalCollisions = 0;
  state.deletedThisRound = 0;
  state.exitedThisRound = 0;
  state.overallDeleted = 0;
  state.overallExited = 0;
  state.overallPlanes = 0;
  state.roundResults = [];
  state.activePlanes = [];
  state.scheduledPlanes = [];
  state.roundPlan = null;
  state.pendingContinue = false;
  state.sessionEnded = false;
  state.roundStartTimestamp = null;
  state.mathState = {
    active: false,
    cooldownUntil: 0,
    expireAt: 0,
    question: null,
    totalAsked: 0,
    correct: 0,
    wrong: 0,
    missed: 0,
  };
  resetMathRoundMessage();
  updateStats();
  render();
}

async function startNewGame() {
  readMenuSettings();
  resetSession();
  switchScreen('game');
  resizeCanvas();
  await runCountdown();
  prepareRound(1);
  startLoop();
}

els.themeSelect.addEventListener('change', (e) => applyTheme(e.target.value));
els.modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    syncMenuVisibility();
  });
});
els.startGameBtn.addEventListener('click', startNewGame);
els.restartBtn.addEventListener('click', startNewGame);
els.menuBtn.addEventListener('click', () => {
  resetSession();
  switchScreen('menu');
});
els.continueYesBtn.addEventListener('click', continueUnlimited);
els.continueNoBtn.addEventListener('click', () => endGame('Player ended unlimited mode.'));
els.playAgainBtn.addEventListener('click', startNewGame);
els.scoreMenuBtn.addEventListener('click', () => {
  resetSession();
  switchScreen('menu');
});
els.canvas.addEventListener('click', handleCanvasClick);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => {
  if (handleMathAnswer(event.key, performance.now())) {
    event.preventDefault();
  }
});

syncMenuVisibility();
applyTheme(els.themeSelect.value);
resizeCanvas();
resetMathRoundMessage();
switchScreen('menu');
