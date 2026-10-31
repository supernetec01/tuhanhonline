import { type Settings } from './config.js';
export type Point = { x: number; y: number };
export type Waypoint = Point & { id: string; ms: number };
export type Motion = { path: Waypoint[]; startedAt: number; endsAt: number; target: string };
export type NavNode = Point & { id: string; walkable: boolean };
export type Graph = { nodes: Map<string, NavNode>; edges: Map<string, string[]> };
export const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * 1.4, a.y - b.y);
export function queuePoint(index: number): Point {
  return { x: index < 6 ? 47 : 53, y: 53 + (index < 6 ? index : 11 - index) * 5 };
}
const graphCache = new Map<string, Graph>();
export function navigation(config: Pick<Settings, 'seatLayout'> & { capacity?: number }): Graph {
  const layout = config.seatLayout
    .filter((s) => s.enabled)
    .sort((a, b) => a.id - b.id)
    .slice(0, config.capacity ?? 72);
  const signature = JSON.stringify(layout);
  const cached = graphCache.get(signature);
  if (cached) return cached;
  const nodes = new Map<string, NavNode>(),
    edges = new Map<string, string[]>();
  const node = (id: string, x: number, y: number, walkable = false) => {
    nodes.set(id, { id, x, y, walkable });
    edges.set(id, []);
  };
  const link = (a: string, b: string) => {
    const from = nodes.get(a)!,
      to = nodes.get(b)!;
    const blocked = layout.some((seat) => {
      if (a === `seat:${seat.id}` || b === `seat:${seat.id}`) return false;
      const hw = seat.scale * 0.5 + 0.4,
        hh = seat.scale * 0.16 + 0.4;
      let lo = 0,
        hi = 1;
      for (const [p, d, min, max] of [
        [from.x, to.x - from.x, seat.x - hw, seat.x + hw],
        [from.y, to.y - from.y, seat.y - hh, seat.y + hh],
      ]) {
        if (Math.abs(d) < 0.0001) {
          if (p < min || p > max) return false;
          continue;
        }
        const u = (min - p) / d,
          v = (max - p) / d;
        lo = Math.max(lo, Math.min(u, v));
        hi = Math.min(hi, Math.max(u, v));
        if (lo > hi) return false;
      }
      return true;
    });
    if (!blocked) {
      edges.get(a)?.push(b);
      edges.get(b)?.push(a);
    }
  };
  const rows = [...new Set(config.seatLayout.filter((s) => s.enabled).map((s) => s.y))].sort(
    (a, b) => a - b,
  );
  node('front:in', 50, 49.5);
  node('front:out', 93, 51, true);
  node('front:left', 7, 51, true);
  for (let r = 0; r < rows.length; r++) {
    const gap = r + 1 < rows.length ? rows[r + 1] - rows[r] : rows[r] - rows[r - 1] || 7.5;
    const y = Math.min(96, rows[r] + Math.max(1.3, gap * 0.48));
    for (const [side, x] of [
      ['left', 7],
      ['mid', 50],
      ['right', 93],
    ] as const) {
      node(`walk:${r}:${side}`, x, y, side !== 'mid' || y > 82);
      if (r) link(`walk:${r - 1}:${side}`, `walk:${r}:${side}`);
    }
    link(`walk:${r}:left`, `walk:${r}:mid`);
    link(`walk:${r}:mid`, `walk:${r}:right`);
    for (const seat of layout.filter((s) => s.y === rows[r])) {
      node(`seat:${seat.id}`, seat.x, seat.y);
      node(`exit:${seat.id}`, seat.x, y);
      link(`seat:${seat.id}`, `exit:${seat.id}`);
      link(`exit:${seat.id}`, `walk:${r}:${seat.x < 50 ? 'left' : 'right'}`);
      link(`exit:${seat.id}`, `walk:${r}:mid`);
    }
  }
  if (rows.length) {
    link('front:in', 'walk:0:mid');
    link('front:out', 'walk:0:right');
    link('front:left', 'walk:0:left');
  }
  for (let i = 0; i < 12; i++) {
    const col = i < 6 ? 0 : 1,
      index = col ? 11 - i : i;
    node(`queue:${i}`, queuePoint(i).x, queuePoint(i).y);
    if (i) link(`queue:${i - 1}`, `queue:${i}`);
    // Separate access from the back of each column, so newcomers never cut through the line.
    if (i === 5 || i === 6) {
      const closest = rows
        .map((y, r) => ({ r, d: Math.abs(y - (53 + index * 5)) }))
        .sort((a, b) => a.d - b.d)[0];
      if (closest) link(`queue:${i}`, `walk:${closest.r}:mid`);
    }
  }
  link('queue:0', 'front:in');
  for (const [id, x] of [
    ['A', 43],
    ['B', 57],
  ] as const) {
    node(`station:${id}`, x, 49.5);
    node(`return:${id}`, x, 51);
    link('front:in', `station:${id}`);
    link(`station:${id}`, `return:${id}`);
    link(`return:${id}`, 'front:out');
  }
  const graph = { nodes, edges };
  graphCache.set(signature, graph);
  if (graphCache.size > 8) graphCache.delete(graphCache.keys().next().value!);
  return graph;
}
export function shortestPath(
  g: Graph,
  from: string,
  to: string,
  blocked: Set<string> = new Set(),
  canTraverse?: (from: NavNode, to: NavNode) => boolean,
): NavNode[] | null {
  if (!g.nodes.has(from) || !g.nodes.has(to) || blocked.has(to)) return null;
  const costs = new Map([[from, 0]]),
    previous = new Map<string, string>(),
    todo = new Set([from]);
  while (todo.size) {
    const current = [...todo].sort((a, b) => costs.get(a)! - costs.get(b)!)[0];
    todo.delete(current);
    if (current === to) {
      const out = [g.nodes.get(to)!];
      while (previous.has(out[0].id)) out.unshift(g.nodes.get(previous.get(out[0].id)!)!);
      return out;
    }
    for (const next of g.edges.get(current) ?? []) {
      if (blocked.has(next)) continue;
      if (canTraverse && !canTraverse(g.nodes.get(current)!, g.nodes.get(next)!)) continue;
      // Returns use the outer aisle; arrivals cannot shortcut through an occupied station.
      if (from.startsWith('station:') && next === 'front:in') continue;
      const cost = costs.get(current)! + distance(g.nodes.get(current)!, g.nodes.get(next)!);
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost);
        previous.set(next, current);
        todo.add(next);
      }
    }
  }
  return null;
}
export function timedPath(nodes: NavNode[], speed: number): Waypoint[] {
  if (!nodes.length) return [];
  let ms = 500;
  return [
    { ...nodes[0], ms: 0 },
    { ...nodes[0], ms: 500 },
    ...nodes.slice(1).map((p, i) => {
      ms += Math.max(150, Math.ceil((distance(nodes[i], p) / speed) * 1000));
      return { id: p.id, x: p.x, y: p.y, ms };
    }),
  ];
}
export function sampleMotion(
  motion: Motion,
  now: number,
): Point & { direction: 'front' | 'back' | 'left' | 'right'; walking: boolean } {
  const t = now - motion.startedAt,
    p = motion.path;
  if (!p.length) return { x: 50, y: 95, direction: 'back', walking: false };
  for (let i = 1; i < p.length; i++)
    if (t < p[i].ms) {
      const a = p[i - 1],
        b = p[i],
        f = Math.max(0, Math.min(1, (t - a.ms) / (b.ms - a.ms)));
      const direction =
        Math.abs(b.x - a.x) * 1.4 > Math.abs(b.y - a.y)
          ? b.x > a.x
            ? 'right'
            : 'left'
          : b.y > a.y
            ? 'front'
            : 'back';
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        direction,
        walking: t >= a.ms && distance(a, b) > 0.001,
      };
    }
  return { ...p.at(-1)!, direction: 'back', walking: false };
}
// Continuous foot-space collision check over overlapping segment times; no frame-by-frame network updates.
export function pathsConflict(a: Motion, b: Motion, radius = 1.3) {
  for (let i = 1; i < a.path.length; i++)
    for (let j = 1; j < b.path.length; j++) {
      const a0 = a.startedAt + a.path[i - 1].ms,
        a1 = a.startedAt + a.path[i].ms,
        b0 = b.startedAt + b.path[j - 1].ms,
        b1 = b.startedAt + b.path[j].ms;
      const lo = Math.max(a0, b0),
        hi = Math.min(a1, b1);
      if (hi < lo) continue;
      const at = sampleMotion(a, lo),
        bt = sampleMotion(b, lo),
        ae = sampleMotion(a, hi),
        be = sampleMotion(b, hi);
      const dx = (at.x - bt.x) * 1.4,
        dy = at.y - bt.y,
        vx = (ae.x - at.x - be.x + bt.x) * 1.4,
        vy = ae.y - at.y - be.y + bt.y;
      const f = Math.max(0, Math.min(1, -(dx * vx + dy * vy) / (vx * vx + vy * vy || 1)));
      if (Math.hypot(dx + vx * f, dy + vy * f) < radius) return true;
    }
  return false;
}
