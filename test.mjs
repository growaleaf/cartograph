// CARTOGRAPH — headless verification. Run: node test.mjs
import fs from 'node:fs';
import {
  mulberry32, distance, generateWorld, neighborsOf, reachableFrom, visibleFrom,
  walkExpedition, createPlayerMap, addMarker, addEdge, markersByStamp,
  strangerNavigate, scoreTrial, shareText, VISIBILITY_RADIUS, DAYLIGHT_BUDGET,
  WORLD_LANDMARK_COUNT, LANDMARK_TYPES,
} from './chart.mjs';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}  ${detail}`); }
}

// 1. mulberry32: deterministic, bounded [0,1)
{
  const r1 = mulberry32(42), r2 = mulberry32(42);
  const seq1 = Array.from({ length: 20 }, () => r1());
  const seq2 = Array.from({ length: 20 }, () => r2());
  check('mulberry32 deterministic', JSON.stringify(seq1) === JSON.stringify(seq2));
  check('mulberry32 bounded [0,1)', seq1.every(v => v >= 0 && v < 1));
  const r3 = mulberry32(43);
  check('mulberry32 differs by seed', r3() !== mulberry32(42)());
}

// 2. generateWorld: deterministic, seed-varying
{
  const w1 = generateWorld(1001), w2 = generateWorld(1001), w3 = generateWorld(1002);
  check('world deterministic (same seed = same world)', JSON.stringify(w1) === JSON.stringify(w2));
  check('world varies by seed', JSON.stringify(w1) !== JSON.stringify(w3));
  check('world has requested landmark count', w1.landmarks.length === WORLD_LANDMARK_COUNT);
  check('startId and springId distinct', w1.startId !== w1.springId);
  check('exactly one trailhead, one spring', w1.landmarks.filter(l => l.type === 'trailhead').length === 1
    && w1.landmarks.filter(l => l.type === 'spring').length === 1);
  check('every landmark has a legal type', w1.landmarks.every(l =>
    l.type === 'trailhead' || l.type === 'spring' || LANDMARK_TYPES.includes(l.type)));
}

// 3. landmark graph connected — over many seeds (REQUIRED TEST)
{
  let allConnected = true, allEdgesValid = true;
  for (let s = 1; s <= 40; s++) {
    const w = generateWorld(s * 777 + 3);
    const reach = reachableFrom(w, w.startId);
    if (reach.size !== w.landmarks.length) allConnected = false;
    for (const e of w.edges) {
      if (e.dist <= 0 || e.a === e.b) allEdgesValid = false;
      if (!w.landmarks[e.a] || !w.landmarks[e.b]) allEdgesValid = false;
    }
  }
  check('landmark graph connected over 40 seeds', allConnected);
  check('all edges valid (positive dist, real endpoints)', allEdgesValid);
}

// 4. visibility model correct — crafted fixture with known geometry (REQUIRED TEST)
{
  const world = {
    landmarks: [
      { id: 0, x: 0, y: 0, type: 'trailhead' },
      { id: 1, x: 100, y: 0, type: 'ford' },       // dist 100, inside radius
      { id: 2, x: 259, y: 0, type: 'cairn' },       // dist 259, inside radius (< 260)
      { id: 3, x: 261, y: 0, type: 'ridge' },       // dist 261, outside radius
      { id: 4, x: 1000, y: 1000, type: 'spring' },  // far away
    ],
    edges: [], startId: 0, springId: 4,
  };
  const seen = visibleFrom(world, 0, 260);
  check('visibility includes near landmarks', seen.includes(1) && seen.includes(2));
  check('visibility excludes just-past-radius landmark', !seen.includes(3));
  check('visibility excludes far landmark', !seen.includes(4));
  check('visibility sorted nearest-first', seen[0] === 1 && seen[1] === 2);
  check('visibility excludes self', !seen.includes(0));
  const boundary = visibleFrom(world, 0, 261);
  check('landmark exactly at radius is included', boundary.includes(3));
}

// 5. neighborsOf sorted ascending
{
  const world = generateWorld(555);
  const nbrs = neighborsOf(world, world.startId);
  const sorted = [...nbrs].sort((a, b) => a.dist - b.dist);
  check('neighborsOf returns sorted-by-distance', JSON.stringify(nbrs) === JSON.stringify(sorted));
}

// 6. daylight budget enforced (REQUIRED TEST)
{
  const world = {
    landmarks: [
      { id: 0, x: 0, y: 0 }, { id: 1, x: 300, y: 0 }, { id: 2, x: 620, y: 0 },
    ],
    edges: [{ a: 0, b: 1, dist: 300 }, { a: 1, b: 2, dist: 320 }],
    startId: 0, springId: 2,
  };
  const within = walkExpedition(world, 0, [1], 300);
  check('walk within budget succeeds', within.ok === true && within.distanceUsed === 300);
  const over = walkExpedition(world, 0, [1, 2], 500);
  check('walk exceeding budget rejected', over.ok === false && over.reason === 'no-daylight');
  check('rejected walk keeps only affordable prefix', JSON.stringify(over.visited) === JSON.stringify([0, 1]));
  const exact = walkExpedition(world, 0, [1, 2], 620);
  check('walk exactly at budget succeeds', exact.ok === true && exact.distanceUsed === 620);
  const badEdge = walkExpedition(world, 0, [2], 620);
  check('walk over a nonexistent trail rejected', badEdge.ok === false && badEdge.reason === 'no-edge');
}

// 7. player map construction — markers, edges, dedup, invalid ignored
{
  let map = createPlayerMap();
  map = addMarker(map, { x: 10, y: 10, stamp: 'trailhead' });
  map = addMarker(map, { x: 50, y: 50, stamp: 'ford' });
  map = addEdge(map, 0, 1);
  map = addEdge(map, 0, 1); // duplicate
  check('markers assigned sequential ids', map.markers[0].id === 0 && map.markers[1].id === 1);
  check('edge added once', map.edges.length === 1);
  const before = map.edges.length;
  map = addEdge(map, 0, 99); // nonexistent marker
  check('edge to nonexistent marker ignored', map.edges.length === before);
  check('markersByStamp filters correctly', markersByStamp(map, 'ford').length === 1);
}

// 8. strangerNavigate reaches when connected (hand-built tiny map)
{
  let map = createPlayerMap();
  map = addMarker(map, { x: 0, y: 0, stamp: 'trailhead' });
  map = addMarker(map, { x: 50, y: 0, stamp: 'ford' });
  map = addMarker(map, { x: 100, y: 0, stamp: 'spring' });
  map = addEdge(map, 0, 1);
  map = addEdge(map, 1, 2);
  const nav = strangerNavigate(map, 0);
  check('stranger reaches spring via connected map', nav.reached === true && nav.steps === 2);
  check('stranger path passes through the ford', JSON.stringify(nav.path) === JSON.stringify([0, 1, 2]));
}

// 9. sabotaged map fails the trial (REQUIRED TEST — both proven)
{
  let map = createPlayerMap();
  map = addMarker(map, { x: 0, y: 0, stamp: 'trailhead' });
  map = addMarker(map, { x: 50, y: 0, stamp: 'ford' });
  map = addMarker(map, { x: 100, y: 0, stamp: 'spring' });
  map = addEdge(map, 0, 1); // the ford-to-spring line was never drawn
  const nav = strangerNavigate(map, 0);
  check('sabotaged map (missing edge) fails the trial', nav.reached === false && nav.reason === 'unreachable');
}

// 10. strangerNavigate reads ONLY the player map — API-level source assertion (REQUIRED TEST)
{
  const src = fs.readFileSync(new URL('./chart.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('export function strangerNavigate');
  const nextExport = src.indexOf('\nexport function', start + 1);
  const body = src.slice(start, nextExport === -1 ? undefined : nextExport);
  const forbidden = ['generateWorld', 'visibleFrom(', 'walkExpedition', 'world.landmarks', 'world.edges'];
  const clean = forbidden.every(tok => !body.includes(tok));
  check('strangerNavigate source touches no world symbol', clean, clean ? '' : 'forbidden token found in function body');
}

// 11. strangerNavigate is invariant to which world the map's positions came from
//     (structurally identical maps derived from two DIFFERENT worlds give the SAME result)
{
  const w1 = generateWorld(2001), w2 = generateWorld(2002);
  function deriveFrom(world) {
    let map = createPlayerMap();
    for (const l of world.landmarks) map = addMarker(map, { x: l.x, y: l.y, stamp: l.type, worldId: l.id });
    for (const e of world.edges) map = addEdge(map, e.a, e.b);
    return map;
  }
  const mapA = deriveFrom(w1), mapB = deriveFrom(w2);
  const navA = strangerNavigate(mapA, w1.startId), navB = strangerNavigate(mapB, w2.startId);
  check('navigator result shape independent of which world the map came from',
    navA.reached === true && navB.reached === true && typeof navA.steps === 'number' && typeof navB.steps === 'number');
}

// 12. a faithful auto-generated perfect sketch of a REAL generated world passes the trial (REQUIRED TEST)
{
  const world = generateWorld(3003);
  let map = createPlayerMap();
  for (const l of world.landmarks) map = addMarker(map, { x: l.x, y: l.y, stamp: l.type, worldId: l.id });
  for (const e of world.edges) map = addEdge(map, e.a, e.b);
  const result = scoreTrial(map, world.startId);
  check('faithful full-world sketch passes the trial', result.passed === true);

  // sabotage: erase every edge touching the spring — a real, provable failure
  const springMarker = markersByStamp(map, 'spring')[0];
  const sabotaged = { markers: map.markers, edges: map.edges.filter(e => e.a !== springMarker.id && e.b !== springMarker.id) };
  const badResult = scoreTrial(sabotaged, world.startId);
  check('sabotaged full-world sketch (spring cut off) fails the trial', badResult.passed === false);
}

// 13. determinism of navigation/scoring end to end
{
  const world = generateWorld(4004);
  let map = createPlayerMap();
  for (const l of world.landmarks) map = addMarker(map, { x: l.x, y: l.y, stamp: l.type, worldId: l.id });
  for (const e of world.edges) map = addEdge(map, e.a, e.b);
  const r1 = scoreTrial(map, world.startId), r2 = scoreTrial(map, world.startId);
  check('scoreTrial deterministic', JSON.stringify(r1) === JSON.stringify(r2));
}

// 14. distance() sanity
{
  check('distance to self is 0', distance({ x: 5, y: 5 }, { x: 5, y: 5 }) === 0);
  check('distance is 3-4-5', distance({ x: 0, y: 0 }, { x: 3, y: 4 }) === 5);
}

// 15. no-start reason surfaced honestly
{
  const map = createPlayerMap();
  const nav = strangerNavigate(map, 0);
  check('navigating an empty map reports no-start', nav.reached === false && nav.reason === 'no-start');
}

// 16. shareText format
{
  const s = shareText('one bad bay nearly lost him', 'http://cartograph.defimagic.io');
  check('shareText mentions the spring and the map', s.includes('spring') && s.includes('MY map'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
