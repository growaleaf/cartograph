// CARTOGRAPH — the pure core. No DOM, no WebAudio, no Date.now(), no Math.random().
// Every function here is deterministic given its inputs.

export const LANDMARK_TYPES = [
  'coastline', 'split-rock', 'ford', 'cairn', 'ridge', 'grove', 'bluff', 'marsh', 'hollow',
];
export const VISIBILITY_RADIUS = 260;
export const DAYLIGHT_BUDGET = 620;
export const WORLD_LANDMARK_COUNT = 12;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/* ---------------- world generation (the true wilderness — never shown directly) --------------- */

export function generateWorld(seed, opts = {}) {
  const count = opts.count || WORLD_LANDMARK_COUNT;
  const W = opts.width || 960, H = opts.height || 640;
  const rng = mulberry32(seed);
  const landmarks = [];
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, tries = 0, ok = false;
    do {
      x = 40 + rng() * (W - 80);
      y = 40 + rng() * (H - 80);
      ok = tries > 40 || landmarks.every(l => Math.hypot(l.x - x, l.y - y) >= 90);
      tries++;
    } while (!ok);
    landmarks.push({ id: i, x: round2(x), y: round2(y), type: null, name: '' });
  }

  const startId = 0;
  let springId = 1, bestD = -1;
  for (let i = 1; i < count; i++) {
    const d = distance(landmarks[startId], landmarks[i]);
    if (d > bestD) { bestD = d; springId = i; }
  }
  landmarks[startId].type = 'trailhead';
  landmarks[startId].name = 'the trailhead';
  landmarks[springId].type = 'spring';
  landmarks[springId].name = 'the spring';

  let typeCursor = 0;
  for (let i = 0; i < count; i++) {
    if (i === startId || i === springId) continue;
    const t = LANDMARK_TYPES[typeCursor % LANDMARK_TYPES.length];
    typeCursor++;
    landmarks[i].type = t;
    landmarks[i].name = t.replace('-', ' ');
  }

  // minimum spanning tree (Prim's) — guarantees a connected wilderness
  const inTree = new Set([0]);
  const edges = [];
  while (inTree.size < count) {
    let best = null;
    for (const a of inTree) {
      for (let b = 0; b < count; b++) {
        if (inTree.has(b)) continue;
        const d = distance(landmarks[a], landmarks[b]);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    edges.push({ a: best.a, b: best.b, dist: round2(best.d) });
    inTree.add(best.b);
  }

  // extra trails for texture (cycles) — deterministic, continues the same rng sequence
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const already = edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
      if (already) continue;
      const d = distance(landmarks[a], landmarks[b]);
      const roll = rng();
      if (d < 340 && roll < 0.16) edges.push({ a, b, dist: round2(d) });
    }
  }

  return { seed, width: W, height: H, landmarks, edges, startId, springId };
}

export function neighborsOf(world, id) {
  const out = [];
  for (const e of world.edges) {
    if (e.a === id) out.push({ id: e.b, dist: e.dist });
    else if (e.b === id) out.push({ id: e.a, dist: e.dist });
  }
  return out.sort((p, q) => p.dist - q.dist);
}

export function reachableFrom(world, fromId) {
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighborsOf(world, cur)) {
      if (!seen.has(n.id)) { seen.add(n.id); queue.push(n.id); }
    }
  }
  return seen;
}

// observation model — what a landmark's neighborhood reveals from where you stand
export function visibleFrom(world, atId, radius = VISIBILITY_RADIUS) {
  const at = world.landmarks[atId];
  if (!at) return [];
  return world.landmarks
    .filter(l => l.id !== atId && distance(l, at) <= radius)
    .sort((p, q) => distance(p, at) - distance(q, at))
    .map(l => l.id);
}

// one expedition: walk a chosen route, spend daylight, gather what you saw
export function walkExpedition(world, startId, path, budget = DAYLIGHT_BUDGET) {
  const visited = [startId];
  let used = 0, cur = startId;
  for (const next of path) {
    const edge = neighborsOf(world, cur).find(n => n.id === next);
    if (!edge) return { ok: false, reason: 'no-edge', visited, distanceUsed: round2(used), observed: [] };
    if (used + edge.dist > budget) {
      return { ok: false, reason: 'no-daylight', visited, distanceUsed: round2(used), observed: [] };
    }
    used += edge.dist;
    visited.push(next);
    cur = next;
  }
  const observed = new Set();
  for (const id of visited) for (const v of visibleFrom(world, id)) observed.add(v);
  return { ok: true, reason: null, visited, distanceUsed: round2(used), observed: [...observed] };
}

/* ---------------- the player's own map — the ONLY interface the stranger ever gets --------------- */

export function createPlayerMap() { return { markers: [], edges: [] }; }

export function addMarker(map, marker) {
  const id = map.markers.length;
  const m = {
    id, x: marker.x, y: marker.y, stamp: marker.stamp,
    label: marker.label || '', worldId: marker.worldId ?? null,
  };
  return { markers: [...map.markers, m], edges: [...map.edges] };
}

export function addEdge(map, fromId, toId) {
  if (fromId === toId) return map;
  const bothExist = map.markers.some(m => m.id === fromId) && map.markers.some(m => m.id === toId);
  if (!bothExist) return map;
  const dup = map.edges.some(e => (e.a === fromId && e.b === toId) || (e.a === toId && e.b === fromId));
  if (dup) return map;
  return { markers: [...map.markers], edges: [...map.edges, { a: fromId, b: toId }] };
}

export function markersByStamp(map, stamp) { return map.markers.filter(m => m.stamp === stamp); }

// THE STRANGER — walks honestly on the player's drawing alone. This function receives
// no world, and must never receive one: the sketch's quality IS the stranger's capability.
export function strangerNavigate(playerMap, startMarkerId, opts = {}) {
  const targetStamp = opts.targetStamp || 'spring';
  const maxSteps = opts.maxSteps || 500;

  if (!playerMap.markers.some(m => m.id === startMarkerId)) {
    return { reached: false, path: [], steps: 0, reason: 'no-start' };
  }
  const stampOf = new Map(playerMap.markers.map(m => [m.id, m.stamp]));
  if (stampOf.get(startMarkerId) === targetStamp) {
    return { reached: true, path: [startMarkerId], steps: 0, reason: null };
  }

  const adj = new Map();
  for (const e of playerMap.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }

  const prev = new Map([[startMarkerId, null]]);
  const queue = [startMarkerId];
  let head = 0, found = null;
  while (head < queue.length && queue.length <= maxSteps + 1) {
    const cur = queue[head++];
    for (const nx of (adj.get(cur) || [])) {
      if (prev.has(nx)) continue;
      prev.set(nx, cur);
      if (stampOf.get(nx) === targetStamp) { found = nx; break; }
      queue.push(nx);
    }
    if (found) break;
  }
  if (!found) return { reached: false, path: [], steps: 0, reason: 'unreachable' };

  const path = [found];
  let c = found;
  while (prev.get(c) !== null && prev.get(c) !== undefined) { c = prev.get(c); path.push(c); }
  path.reverse();
  return { reached: true, path, steps: path.length - 1, reason: null };
}

export function scoreTrial(playerMap, startMarkerId, opts = {}) {
  const nav = strangerNavigate(playerMap, startMarkerId, opts);
  return { passed: nav.reached, steps: nav.steps, path: nav.path, reason: nav.reason };
}

export function shareText(caveat, url) {
  return `🗺️ CARTOGRAPH · the stranger reached the spring by MY map · ${caveat} · ${url}`;
}
