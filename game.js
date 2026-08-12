// CARTOGRAPH — you get no map screen. You get a pencil.
import {
  generateWorld, neighborsOf, visibleFrom, walkExpedition,
  createPlayerMap, addMarker, addEdge, markersByStamp,
  strangerNavigate, scoreTrial, shareText,
  DAYLIGHT_BUDGET, LANDMARK_TYPES,
} from './chart.mjs';

/* ---------------- store ---------------- */
const SK = 'ctg_v1';
function load() { try { return JSON.parse(localStorage.getItem(SK)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(SK, JSON.stringify(ST)); } catch {} }
const ST = load();
if (!ST.seed) ST.seed = Math.floor(Math.random() * 2 ** 31);
if (!ST.day) ST.day = 1;
if (ST.atWorldId === undefined) ST.atWorldId = null;
if (ST.daylightLeft === undefined) ST.daylightLeft = DAYLIGHT_BUDGET;
ST.observed = ST.observed || [];        // worldIds whose true type is known
ST.pendingObserved = ST.pendingObserved || []; // observed this expedition, not yet marked
ST.playerMap = ST.playerMap || createPlayerMap();
ST.worldIdToMarkerId = ST.worldIdToMarkerId || {};
ST.inkStrokes = ST.inkStrokes || [];
ST.camped = ST.camped || 0;
ST.expeditionActive = !!ST.expeditionActive;
ST.unlockedTypes = ST.unlockedTypes || ['trailhead'];
ST.lastTrial = ST.lastTrial || null;

const WORLD = generateWorld(ST.seed);
if (ST.atWorldId === null) ST.atWorldId = WORLD.startId;

/* ---------------- icon rendering (pencil-on-cream stamp glyphs) ---------------- */
const STAMP_ICONS = {
  trailhead: (x, ctx, s) => { ctx.beginPath(); ctx.moveTo(x[0], x[1] - s); ctx.lineTo(x[0] - s, x[1] + s); ctx.lineTo(x[0] + s, x[1] + s); ctx.closePath(); ctx.stroke(); },
  spring: (x, ctx, s) => { for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x[0], x[1], s * (0.35 + i * 0.3), 0, Math.PI * 2); ctx.stroke(); } },
  coastline: (x, ctx, s) => { ctx.beginPath(); for (let i = -2; i <= 2; i++) ctx.quadraticCurveTo(x[0] + i * s * 0.4, x[1] + (i % 2 ? s * 0.3 : -s * 0.3), x[0] + (i + 1) * s * 0.4, x[1]); ctx.stroke(); },
  'split-rock': (x, ctx, s) => { ctx.beginPath(); ctx.moveTo(x[0] - s * 0.6, x[1] + s * 0.5); ctx.lineTo(x[0] - s * 0.1, x[1] - s * 0.6); ctx.lineTo(x[0] + s * 0.1, x[1] + s * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x[0] + s * 0.2, x[1] + s * 0.5); ctx.lineTo(x[0] + s * 0.7, x[1] - s * 0.4); ctx.lineTo(x[0] + s * 0.9, x[1] + s * 0.5); ctx.stroke(); },
  ford: (x, ctx, s) => { ctx.beginPath(); ctx.moveTo(x[0] - s, x[1] - s * 0.5); ctx.lineTo(x[0] - s * 0.3, x[1] + s * 0.5); ctx.lineTo(x[0] + s * 0.3, x[1] - s * 0.5); ctx.lineTo(x[0] + s, x[1] + s * 0.5); ctx.stroke(); },
  cairn: (x, ctx, s) => { for (let i = 0; i < 3; i++) { const w = s * (1 - i * 0.28); ctx.strokeRect(x[0] - w / 2, x[1] + s * 0.6 - i * s * 0.5 - s * 0.28, w, s * 0.28); } },
  ridge: (x, ctx, s) => { ctx.beginPath(); ctx.moveTo(x[0] - s, x[1] + s * 0.4); ctx.lineTo(x[0] - s * 0.4, x[1] - s * 0.5); ctx.lineTo(x[0], x[1] + s * 0.1); ctx.lineTo(x[0] + s * 0.4, x[1] - s * 0.5); ctx.lineTo(x[0] + s, x[1] + s * 0.4); ctx.stroke(); },
  grove: (x, ctx, s) => { for (const [dx, dy] of [[-0.4, 0.3], [0.4, 0.3], [0, -0.4]]) { ctx.beginPath(); ctx.arc(x[0] + dx * s, x[1] + dy * s, s * 0.3, 0, Math.PI * 2); ctx.stroke(); } },
  bluff: (x, ctx, s) => { ctx.beginPath(); ctx.moveTo(x[0] - s, x[1] + s * 0.5); ctx.lineTo(x[0] + s * 0.2, x[1] + s * 0.5); ctx.lineTo(x[0] + s, x[1] - s * 0.5); ctx.stroke(); },
  marsh: (x, ctx, s) => { for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x[0] + i * s * 0.5, x[1] + s * 0.5); ctx.lineTo(x[0] + i * s * 0.5, x[1] - s * 0.2); ctx.stroke(); } },
  hollow: (x, ctx, s) => { ctx.beginPath(); ctx.arc(x[0], x[1], s * 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x[0], x[1], s * 0.15, 0, Math.PI * 2); ctx.fill(); },
  mark: (x, ctx, s) => { ctx.beginPath(); ctx.moveTo(x[0] - s * 0.5, x[1] - s * 0.5); ctx.lineTo(x[0] + s * 0.5, x[1] + s * 0.5); ctx.moveTo(x[0] + s * 0.5, x[1] - s * 0.5); ctx.lineTo(x[0] - s * 0.5, x[1] + s * 0.5); ctx.stroke(); },
};
const STAMP_PALETTE = ['trailhead', 'spring', ...LANDMARK_TYPES, 'mark'];

function drawMap(cv, map, inkStrokes, opts = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#faf3e0'; ctx.fillRect(0, 0, W, H);

  // subtle paper grain
  ctx.strokeStyle = 'rgba(59,47,34,0.05)'; ctx.lineWidth = 1;
  for (let i = 0; i < H; i += 26) { ctx.beginPath(); ctx.moveTo(0, i + (i % 52 === 0 ? 3 : 0)); ctx.lineTo(W, i); ctx.stroke(); }

  // freehand ink
  ctx.strokeStyle = '#3b2f22'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of inkStrokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath(); ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.stroke();
  }

  // drawn trail lines between markers
  ctx.strokeStyle = '#8a5a34'; ctx.lineWidth = 2;
  ctx.setLineDash([1, 5]); ctx.lineCap = 'round';
  const byId = new Map(map.markers.map(m => [m.id, m]));
  for (const e of map.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // stamps
  for (const m of map.markers) {
    const isHi = opts.highlight && opts.highlight.includes(m.id);
    const isCur = opts.current === m.id;
    ctx.strokeStyle = isCur ? '#4f6b3a' : (isHi ? '#6b4a2b' : '#5a4a34');
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = isHi || isCur ? 2.6 : 1.8;
    if (isHi) { ctx.beginPath(); ctx.arc(m.x, m.y, 16, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(107,74,43,.35)'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.6; }
    const icon = STAMP_ICONS[m.stamp] || STAMP_ICONS.mark;
    icon([m.x, m.y], ctx, 10);
    if (m.label || opts.showTypeLabels) {
      ctx.font = '11px Georgia, serif'; ctx.fillStyle = '#5a4a34'; ctx.textAlign = 'center';
      ctx.fillText(m.label || m.stamp.replace('-', ' '), m.x, m.y + 22);
    }
  }

  // stranger's live walk
  if (opts.dotAt) {
    ctx.fillStyle = '#9c4a3a';
    ctx.beginPath(); ctx.arc(opts.dotAt.x, opts.dotAt.y, 6, 0, Math.PI * 2); ctx.fill();
  }
}

// abstract, non-literal "surroundings" sketch for the raw first expedition — atmosphere only
function drawScene(cv, seedish) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f6efdc'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(59,47,34,.28)'; ctx.lineWidth = 1.6;
  let a = (seedish % 997) / 997;
  const rnd = () => (a = (a * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const y = H * 0.35 + i * (H * 0.5 / 5) + rnd() * 10;
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6 * rnd());
    ctx.globalAlpha = 0.35 + i * 0.08;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(59,47,34,.5)';
  ctx.font = '13px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('(nothing is drawn here yet)', W / 2, H - 16);
}

/* ---------------- dom / nav ---------------- */
const $ = id => document.getElementById(id);
const SCREENS = ['title', 'how', 'expedition', 'camp', 'trial'];
function show(id) {
  SCREENS.forEach(s => $(s).classList.remove('on'));
  $(id).classList.add('on');
  if (id === 'title') paintTitle();
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));

function paintTitle() {
  $('titleStat').textContent = ST.camped
    ? `day ${ST.day} · ${ST.playerMap.markers.length} marks on your sheet`
    : '';
  $('btnPlay').textContent = ST.camped || ST.expeditionActive ? 'WALK ON' : 'BEGIN';
  const trailheadMarked = ST.worldIdToMarkerId[WORLD.startId] !== undefined;
  $('btnTrial').style.display = ST.camped > 0 ? 'block' : 'none';
  $('btnTrial').textContent = trailheadMarked ? 'SEND THE STRANGER TO THE SPRING' : 'SEND THE STRANGER (no trailhead marked yet)';
}
$('btnPlay').onclick = () => { ST.expeditionActive = true; save(); enterExpedition(); };
$('btnTrial').onclick = () => enterTrial();

/* ---------------- expedition ---------------- */
function observe(worldId) {
  for (const id of visibleFrom(WORLD, worldId)) {
    if (!ST.observed.includes(id)) { ST.observed.push(id); ST.pendingObserved.push(id); ST.unlockedTypes.push(WORLD.landmarks[id].type); }
  }
  if (!ST.observed.includes(worldId)) { ST.observed.push(worldId); ST.pendingObserved.push(worldId); ST.unlockedTypes.push(WORLD.landmarks[worldId].type); }
}

function enterExpedition() {
  if (ST.pendingObserved.length === 0 && ST.observed.length === 0) observe(WORLD.startId);
  paintExpedition();
  show('expedition');
}

function paintExpedition() {
  $('expDay').textContent = `DAY ${ST.day}`;
  $('gaugeFill').style.width = `${Math.max(0, Math.min(100, (ST.daylightLeft / DAYLIGHT_BUDGET) * 100))}%`;
  const atLandmark = WORLD.landmarks[ST.atWorldId];
  const known = ST.observed.includes(ST.atWorldId);
  $('expNarrate').innerHTML = known
    ? `You stand at <b>${atLandmark.name}</b>.`
    : `You stand somewhere you have never marked.`;

  const usingMap = ST.day > 1; // "on later expeditions you navigate by your own drawing"
  const cv = $('viewCv');
  if (usingMap) {
    drawMap(cv, ST.playerMap, ST.inkStrokes, {
      current: ST.worldIdToMarkerId[ST.atWorldId],
      highlight: reachableMarkerIdsFromHere(),
    });
  } else {
    drawScene(cv, ST.seed + ST.atWorldId * 31);
  }

  const box = $('expChoices');
  box.innerHTML = '';
  const nbrs = neighborsOf(WORLD, ST.atWorldId);

  if (!usingMap) {
    // first expedition ever: raw walking, nothing drawn yet to navigate by
    for (const n of nbrs) {
      const affordable = n.dist <= ST.daylightLeft;
      const seen = ST.observed.includes(n.id);
      const label = seen ? WORLD.landmarks[n.id].name : 'an unclear trail';
      box.appendChild(choiceBtn(`${label}`, `${Math.round(n.dist)} paces of daylight`, affordable, () => walkTo(n.id)));
    }
  } else {
    // every later expedition: navigate ONLY by your own drawn stamps
    const options = ST.playerMap.markers.filter(m =>
      m.worldId !== null && m.worldId !== ST.atWorldId &&
      nbrs.some(n => n.id === m.worldId));
    if (!options.length) {
      const stuck = document.createElement('div');
      stuck.className = 'choice stuck';
      stuck.textContent = 'Your sketch shows nothing leading anywhere from here. Make camp and add to it.';
      box.appendChild(stuck);
    }
    for (const m of options) {
      const edge = nbrs.find(n => n.id === m.worldId);
      const affordable = edge.dist <= ST.daylightLeft;
      const label = m.label || m.stamp.replace('-', ' ');
      box.appendChild(choiceBtn(`follow the mark: “${label}”`, `${Math.round(edge.dist)} paces of daylight`, affordable, () => walkTo(m.worldId)));
    }
  }

  const canMoveAtAll = usingMap
    ? ST.playerMap.markers.some(m => m.worldId !== null && m.worldId !== ST.atWorldId && nbrs.some(n => n.id === m.worldId && n.dist <= ST.daylightLeft))
    : nbrs.some(n => n.dist <= ST.daylightLeft);
  if (!canMoveAtAll || ST.daylightLeft <= 0) {
    const note = document.createElement('div');
    note.className = 'gentle';
    note.textContent = ST.daylightLeft <= 0 ? 'The light is gone. Time to make camp.' : 'No affordable trail from here. Make camp.';
    box.appendChild(note);
  }
}

function reachableMarkerIdsFromHere() {
  const nbrs = neighborsOf(WORLD, ST.atWorldId);
  return ST.playerMap.markers
    .filter(m => m.worldId !== null && nbrs.some(n => n.id === m.worldId))
    .map(m => m.id);
}

function choiceBtn(title, sub, enabled, fn) {
  const b = document.createElement('button');
  b.className = 'choice';
  b.innerHTML = `${title}<div class="d">${sub}</div>`;
  if (!enabled) b.disabled = true;
  b.onclick = fn;
  return b;
}

function walkTo(worldId) {
  const res = walkExpedition(WORLD, ST.atWorldId, [worldId], ST.daylightLeft);
  if (!res.ok) { paintExpedition(); return; }
  ST.atWorldId = worldId;
  ST.daylightLeft = Math.max(0, ST.daylightLeft - res.distanceUsed);
  observe(worldId);
  save();
  paintExpedition();
}

$('btnCamp').onclick = () => enterCamp();

/* ---------------- camp: the only place the map is ever drawn ---------------- */
let campTool = null;
let drawingStroke = null;
let connectFrom = null;

function enterCamp() {
  ST.expeditionActive = false;
  ST.camped++;
  save();
  campTool = null; connectFrom = null;
  paintCamp();
  show('camp');
}

function pendingQueue() { return ST.pendingObserved.filter(id => ST.worldIdToMarkerId[id] === undefined); }

function paintCamp() {
  const pending = pendingQueue();
  $('campTitle').textContent = `CAMP — NIGHT ${ST.day}`;
  if (pending.length) {
    const l = WORLD.landmarks[pending[0]];
    $('campPrompt').innerHTML = `You remember passing <b>${l.name}</b>. Tap the sheet where you believe it was.`;
    $('btnSkipPending').style.display = 'block';
    $('campLabel').style.display = 'none';
  } else {
    $('campPrompt').innerHTML = `Add to your sheet, or <b>break camp</b> when it's enough.`;
    $('btnSkipPending').style.display = 'none';
    $('campLabel').style.display = campTool && campTool !== 'ink' && campTool !== 'connect' ? 'block' : 'none';
  }
  paintToolbar();
  redrawCampCanvas();
}

function paintToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '';
  const pending = pendingQueue();
  const tools = pending.length
    ? [{ id: 'stamp:' + WORLD.landmarks[pending[0]].type, glyph: '✎', label: 'place it' }]
    : [
        { id: 'ink', glyph: '〜', label: 'ink' },
        { id: 'connect', glyph: '—', label: 'connect' },
        ...ST.unlockedTypes.filter((t, i, a) => a.indexOf(t) === i).map(t => ({ id: 'stamp:' + t, glyph: '◆', label: t })),
        { id: 'stamp:mark', glyph: '✕', label: 'your own mark' },
      ];
  for (const t of tools) {
    const b = document.createElement('button');
    b.className = 'tool' + (campTool === t.id ? ' on' : '');
    b.title = t.label;
    if (t.id.startsWith('stamp:')) {
      const stampType = t.id.slice(6);
      const cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.strokeStyle = '#3b2f22'; ctx.fillStyle = '#3b2f22'; ctx.lineWidth = 1.8;
      (STAMP_ICONS[stampType] || STAMP_ICONS.mark)([16, 16], ctx, 9);
      b.appendChild(cv);
    } else {
      b.textContent = t.glyph;
    }
    b.onclick = () => { campTool = t.id; connectFrom = null; paintCamp(); };
    bar.appendChild(b);
  }
}

function redrawCampCanvas() {
  const cv = $('mapCv');
  const highlight = campTool === 'connect' && connectFrom !== null ? [connectFrom] : null;
  drawMap(cv, ST.playerMap, ST.inkStrokes, { highlight });
}

function canvasPoint(cv, evt) {
  const r = cv.getBoundingClientRect();
  const px = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
  const py = (evt.touches ? evt.touches[0].clientY : evt.clientY) - r.top;
  return { x: px * (cv.width / r.width), y: py * (cv.height / r.height) };
}
function nearestMarker(pt, radius = 26) {
  let best = null, bestD = radius;
  for (const m of ST.playerMap.markers) {
    const d = Math.hypot(m.x - pt.x, m.y - pt.y);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

const mapCv = $('mapCv');
mapCv.addEventListener('pointerdown', e => {
  const pt = canvasPoint(mapCv, e);
  const pending = pendingQueue();
  if (pending.length) {
    const worldId = pending[0];
    let map = addMarker(ST.playerMap, { x: pt.x, y: pt.y, stamp: WORLD.landmarks[worldId].type, worldId });
    ST.playerMap = map;
    ST.worldIdToMarkerId[worldId] = map.markers[map.markers.length - 1].id;
    save();
    paintCamp();
    return;
  }
  if (campTool === 'ink') {
    drawingStroke = [pt];
    return;
  }
  if (campTool === 'connect') {
    const m = nearestMarker(pt);
    if (!m) return;
    if (connectFrom === null) { connectFrom = m.id; }
    else if (connectFrom !== m.id) { ST.playerMap = addEdge(ST.playerMap, connectFrom, m.id); save(); connectFrom = null; }
    paintCamp();
    return;
  }
  if (campTool && campTool.startsWith('stamp:')) {
    const stamp = campTool.slice(6);
    const label = $('campLabel').style.display !== 'none' ? $('campLabel').value.trim() : '';
    ST.playerMap = addMarker(ST.playerMap, { x: pt.x, y: pt.y, stamp, label, worldId: null });
    $('campLabel').value = '';
    save();
    redrawCampCanvas();
  }
});
mapCv.addEventListener('pointermove', e => {
  if (!drawingStroke) return;
  drawingStroke.push(canvasPoint(mapCv, e));
  redrawCampCanvas();
  const ctx = mapCv.getContext('2d');
  ctx.strokeStyle = '#3b2f22'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(drawingStroke[0].x, drawingStroke[0].y);
  for (const p of drawingStroke) ctx.lineTo(p.x, p.y);
  ctx.stroke();
});
function endStroke() {
  if (!drawingStroke) return;
  if (drawingStroke.length > 1) { ST.inkStrokes.push(drawingStroke); save(); }
  drawingStroke = null;
  redrawCampCanvas();
}
mapCv.addEventListener('pointerup', endStroke);
mapCv.addEventListener('pointerleave', endStroke);

$('btnSkipPending').onclick = () => {
  const pending = pendingQueue();
  if (pending.length) {
    // an honest skip: this observation stays forever un-marked, exactly the vagueness the concept promises
    ST.pendingObserved = ST.pendingObserved.filter(id => id !== pending[0]);
    save();
    paintCamp();
  }
};
$('btnUndo').onclick = () => { ST.inkStrokes.pop(); save(); redrawCampCanvas(); };
$('btnBreakCamp').onclick = () => {
  ST.day++;
  ST.daylightLeft = DAYLIGHT_BUDGET;
  ST.pendingObserved = [];
  ST.expeditionActive = true;
  save();
  enterExpedition();
};

/* ---------------- the stranger's trial ---------------- */
let trialAnim = null;
function enterTrial() {
  const startMarkerId = ST.worldIdToMarkerId[WORLD.startId];
  const cv = $('trialCv');
  drawMap(cv, ST.playerMap, ST.inkStrokes, {});
  $('btnMend').style.display = 'none';
  $('btnSend').style.display = 'inline-block';
  if (startMarkerId === undefined) {
    $('trialNarrate').innerHTML = `A stranger arrives at the trailhead — but you never marked it. <b>They have nowhere to begin.</b>`;
    $('btnSend').disabled = true;
    $('btnMend').style.display = 'inline-block';
  } else {
    $('trialNarrate').innerHTML = `A stranger arrives, lost, asking only for the spring. <b>All you can give them is your sheet.</b>`;
    $('btnSend').disabled = false;
  }
  show('trial');
}
$('btnSend').onclick = () => {
  const startMarkerId = ST.worldIdToMarkerId[WORLD.startId];
  if (startMarkerId === undefined) return;
  const result = scoreTrial(ST.playerMap, startMarkerId);
  ST.lastTrial = { passed: result.passed, steps: result.steps, day: ST.day };
  save();
  $('btnSend').style.display = 'none';
  runTrialAnimation(result, startMarkerId);
};
function runTrialAnimation(result, startMarkerId) {
  const byId = new Map(ST.playerMap.markers.map(m => [m.id, m]));
  const path = result.reached ? result.path : (result.path.length ? result.path : [startMarkerId]);
  const stepMs = 420;
  const t0 = performance.now();
  function frame(now) {
    const idx = Math.min(path.length - 1, Math.floor((now - t0) / stepMs));
    const m = byId.get(path[idx]);
    drawMap($('trialCv'), ST.playerMap, ST.inkStrokes, { dotAt: m ? { x: m.x, y: m.y } : null });
    if (idx < path.length - 1) { trialAnim = requestAnimationFrame(frame); }
    else finishTrial(result);
  }
  trialAnim = requestAnimationFrame(frame);
}
function finishTrial(result) {
  $('trialNarrate').innerHTML = result.passed
    ? `<b>They reached the spring.</b> Your sheet — vague in places, wrong in none that mattered — was enough.`
    : `<b>They got stuck.</b> Somewhere your sheet ran out, or led nowhere real. They are waiting where your ink ends.`;
  $('btnMend').style.display = 'inline-block';
}
$('btnMend').onclick = () => enterCamp();

/* ---------------- dev hook ---------------- */
if (new URLSearchParams(location.search).get('dev') === '1') {
  window.__g = {
    ST, WORLD, save, show,
    enterExpedition, walkTo, enterCamp, enterTrial,
    placePendingAt: (x, y) => {
      const pending = pendingQueue();
      if (!pending.length) return false;
      const worldId = pending[0];
      let map = addMarker(ST.playerMap, { x, y, stamp: WORLD.landmarks[worldId].type, worldId });
      ST.playerMap = map;
      ST.worldIdToMarkerId[worldId] = map.markers[map.markers.length - 1].id;
      save(); paintCamp();
      return true;
    },
    placeStampAt: (stamp, x, y, label) => {
      ST.playerMap = addMarker(ST.playerMap, { x, y, stamp, label: label || '', worldId: null });
      save(); redrawCampCanvas();
      return ST.playerMap.markers[ST.playerMap.markers.length - 1].id;
    },
    connect: (a, b) => { ST.playerMap = addEdge(ST.playerMap, a, b); save(); redrawCampCanvas(); },
    breakCamp: () => $('btnBreakCamp').click(),
    sendStranger: () => $('btnSend').click(),
    skipTrialAnim: () => { if (trialAnim) cancelAnimationFrame(trialAnim); const r = scoreTrial(ST.playerMap, ST.worldIdToMarkerId[WORLD.startId]); finishTrial(r); },
    shareText: caveat => shareText(caveat, location.href),
    reset: () => { localStorage.removeItem(SK); location.reload(); },
  };
}

/* ---------------- boot ---------------- */
paintTitle();
