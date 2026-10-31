import { ApiError, type Tx, type Row } from './db.js';
import { type Settings } from './config.js';
import {
  navigation,
  shortestPath,
  timedPath,
  pathsConflict,
  type Motion,
  type Waypoint,
} from './navigation.js';
export const effectiveExpiry =
  "greatest(e.expires_at,coalesce(CASE WHEN e.character_state='INCENSE_RETURNING' AND e.move_ends_at IS NOT NULL THEN least(e.ritual_protected_until,e.move_ends_at) ELSE e.ritual_protected_until END,e.expires_at))";
export function motionOf(e: Row): Motion | null {
  return e.movement_path && e.move_started_at && e.move_ends_at
    ? {
        path: e.movement_path,
        startedAt: new Date(e.move_started_at).getTime(),
        endsAt: new Date(e.move_ends_at).getTime(),
        target: e.movement_path.at(-1)?.id,
      }
    : null;
}
export async function planMovement(tx: Tx, c: Settings, e: Row, target: string, state: string) {
  const graph = navigation(c),
    from = e.position_node ?? `seat:${e.seat_id}`;
  const others = (
    await tx.query("SELECT * FROM room_entries WHERE status='ACTIVE' AND id<>$1", [e.id])
  ).rows;
  const blocked = new Set<string>();
  for (const other of others) {
    const m = motionOf(other);
    if (m) blocked.add(m.target);
    else if (other.position_node) blocked.add(other.position_node);
  }
  blocked.delete(from);
  const standing = others
    .filter((other) => !motionOf(other))
    .map((other) => graph.nodes.get(other.position_node ?? `seat:${other.seat_id}`))
    .filter((p) => p !== undefined);
  // Some aisle edges span several queue nodes. Exclude edges crossing standing feet,
  // rather than rejecting the shortest route forever when a detour is available.
  const nodes = shortestPath(graph, from, target, blocked, (a, b) =>
    standing.every((p) => {
      const dx = (b.x - a.x) * 1.4,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * 1.4 * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
      );
      return Math.hypot((p.x - a.x) * 1.4 - dx * t, p.y - a.y - dy * t) >= 1.3;
    }),
  );
  if (!nodes) throw new ApiError(409, 'PATH_BUSY', 'Lối đi đang có người. Hãy chờ một chút.');
  const path = timedPath(nodes, c.movement.speed);
  if (state === 'RETURNING' || state === 'INCENSE_RETURNING')
    path.push({ ...path.at(-1)!, ms: path.at(-1)!.ms + 500 });
  let start = new Date((await tx.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
  const now = start;
  let candidate: Motion = { path, startedAt: now, endsAt: now + path.at(-1)!.ms, target };
  const trajectory = (m: Motion): Motion => {
    const wait = Math.max(0, m.startedAt - now),
      p = m.path.map((p) => ({ ...p, ms: p.ms + wait }));
    if (wait) p.unshift({ ...p[0], ms: 0 });
    p.push({ ...p.at(-1)!, ms: Math.max(p.at(-1)!.ms, now - m.startedAt + 120000) });
    return {
      ...m,
      path: p,
      startedAt: Math.min(now, m.startedAt),
      endsAt: Math.max(now + 120000, m.endsAt),
    };
  };
  for (const other of others.filter((other) => !motionOf(other))) {
    const position = graph.nodes.get(other.position_node ?? `seat:${other.seat_id}`);
    if (!position) continue;
    const stationary: Motion = {
      path: [
        { ...position, ms: 0 },
        { ...position, ms: 120000 },
      ],
      startedAt: now,
      endsAt: now + 120000,
      target: position.id,
    };
    if (pathsConflict(trajectory(candidate), stationary))
      throw new ApiError(409, 'PATH_BUSY', 'Lối đi đang có người đứng. Hãy chọn lối khác.');
  }
  for (let attempt = 0; attempt < others.length + 1; attempt++) {
    const conflict = others
      .map(motionOf)
      .find((m) => m && pathsConflict(trajectory(candidate), trajectory(m)));
    if (!conflict) break;
    start = Math.max(start, conflict.endsAt + 350);
    const delay = start - now;
    const delayed = [path[0], ...path.slice(1).map((p) => ({ ...p, ms: p.ms + delay }))];
    candidate = { path: delayed, startedAt: now, endsAt: now + delayed.at(-1)!.ms, target };
    if (attempt === others.length)
      throw new ApiError(409, 'PATH_BUSY', 'Lối đi đang đông. Hãy thử lại.');
  }
  if (candidate.endsAt - now > 120000)
    throw new ApiError(409, 'PATH_BUSY', 'Lối đi đang đông. Hãy chờ.');
  await tx.query(
    'UPDATE room_entries SET character_state=$2,movement_path=$3,move_started_at=$4,move_ends_at=$5 WHERE id=$1',
    [
      e.id,
      state,
      JSON.stringify(candidate.path),
      new Date(candidate.startedAt),
      new Date(candidate.endsAt),
    ],
  );
  return candidate;
}
export async function arriveMovements(tx: Tx, c: Settings) {
  if (!c.movement.enabled) return false;
  const rows = (
    await tx.query(
      `SELECT e.* FROM room_entries e JOIN users u ON u.id=e.user_id WHERE e.status='ACTIVE' AND NOT u.banned AND e.move_ends_at<=clock_timestamp() AND e.move_ends_at<=least(${effectiveExpiry},e.disconnect_deadline) ORDER BY e.move_ends_at,e.sequence`,
    )
  ).rows;
  let dirty = false;
  for (const e of rows) {
    const path = e.movement_path as Waypoint[] | null,
      target = path?.at(-1)?.id;
    if (!target) continue;
    let state = e.character_state;
    if (
      state === 'RETURNING' &&
      (!e.leave_deadline || new Date(e.move_ends_at) > new Date(e.leave_deadline))
    )
      continue;
    if (state === 'RETURNING' || state === 'INCENSE_RETURNING') state = 'SEATED';
    else if (state === 'WALKING_AWAY') state = 'STANDING';
    else if (state === 'INCENSE_WALKING') state = 'INCENSE_WAITING';
    await tx.query(
      `UPDATE room_entries SET position_node=$2,character_state=$3,movement_path=NULL,move_started_at=NULL,move_ends_at=NULL,
      leave_deadline=CASE WHEN $3='SEATED' THEN NULL ELSE leave_deadline END,
      ritual_protected_until=CASE WHEN $3='SEATED' THEN NULL ELSE ritual_protected_until END,
      reward_cursor=CASE WHEN $3='SEATED' AND character_state='RETURNING' THEN $4 ELSE reward_cursor END WHERE id=$1`,
      [e.id, target, state, e.move_ends_at],
    );
    if (e.character_state === 'INCENSE_WALKING')
      await tx.query(
        "UPDATE ritual_actions SET phase='WAITING' WHERE entry_id=$1 AND type='incense' AND status='QUEUED'",
        [e.id],
      );
    dirty = true;
  }
  return dirty;
}
export async function advanceIncense(tx: Tx, c: Settings) {
  if (!c.movement.enabled) return false;
  let dirty = false;
  const entries = (
    await tx.query(
      `SELECT e.*,u.banned FROM room_entries e JOIN users u ON u.id=e.user_id WHERE e.status='ACTIVE' AND NOT u.banned AND least(${effectiveExpiry},e.disconnect_deadline)>clock_timestamp()`,
    )
  ).rows;
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  // Completed ceremonies release the station immediately; returning is a separate protected state.
  const completed = (
    await tx.query(
      "SELECT * FROM ritual_actions WHERE type='incense' AND status='COMPLETED' AND phase='ACTIVE' ORDER BY sequence",
    )
  ).rows;
  for (const a of completed) {
    const e = byEntry.get(a.entry_id);
    if (!e) {
      await tx.query("UPDATE ritual_actions SET phase='DONE' WHERE id=$1", [a.id]);
      continue;
    }
    try {
      await planMovement(tx, c, e, `seat:${e.seat_id}`, 'INCENSE_RETURNING');
      await tx.query("UPDATE ritual_actions SET phase='RETURNING',station=NULL WHERE id=$1", [
        a.id,
      ]);
      dirty = true;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  await tx.query(
    "UPDATE ritual_actions a SET phase='DONE' FROM room_entries e WHERE e.id=a.entry_id AND a.phase='RETURNING' AND e.character_state='SEATED'",
  );
  const actions = (
    await tx.query(
      "SELECT * FROM ritual_actions WHERE type='incense' AND status IN ('QUEUED','RUNNING') AND phase<>'LEGACY' ORDER BY sequence",
    )
  ).rows;
  // Begin burning only after arrival, with dispatch order preserved across both stations.
  for (const a of actions.filter((a) => a.phase === 'TO_STATION')) {
    const e = (await tx.query('SELECT * FROM room_entries WHERE id=$1', [a.entry_id])).rows[0];
    if (!byEntry.has(e.id) || e.movement_path || e.position_node !== `station:${a.station}`)
      continue;
    if (
      actions.some(
        (b) =>
          BigInt(b.sequence) < BigInt(a.sequence) &&
          b.phase === 'TO_STATION' &&
          b.status === 'QUEUED',
      )
    )
      break;
    await tx.query(
      "UPDATE ritual_actions SET status='RUNNING',phase='ACTIVE',started_at=clock_timestamp(),ends_at=clock_timestamp()+interval '5 seconds',duration_ms=5000,cooldown_ms=300000,merit_reward=10 WHERE id=$1",
      [a.id],
    );
    await tx.query("UPDATE room_entries SET character_state='INCENSE_ACTIVE' WHERE id=$1", [e.id]);
    a.phase = 'ACTIVE';
    a.status = 'RUNNING';
    dirty = true;
  }
  // Oldest queued request is the only next dispatch candidate. No later player can pass it.
  for (const station of ['A', 'B']) {
    if (
      (
        await tx.query(
          "SELECT 1 FROM ritual_actions WHERE station=$1 AND status IN ('RUNNING','QUEUED')",
          [station],
        )
      ).rowCount
    )
      continue;
    const a = (
      await tx.query(
        "SELECT * FROM ritual_actions WHERE type='incense' AND status='QUEUED' AND phase IN ('PENDING','TO_QUEUE','WAITING') ORDER BY sequence LIMIT 1",
      )
    ).rows[0];
    if (!a || a.phase !== 'WAITING') break;
    const e = (await tx.query('SELECT * FROM room_entries WHERE id=$1', [a.entry_id])).rows[0];
    if (!byEntry.has(e.id) || e.movement_path) break;
    try {
      await planMovement(tx, c, e, `station:${station}`, 'INCENSE_TO_STATION');
      await tx.query(
        "UPDATE ritual_actions SET phase='TO_STATION',queue_slot=NULL,station=$2 WHERE id=$1",
        [a.id, station],
      );
      dirty = true;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      break;
    }
  }
  const queued = (
    await tx.query(
      "SELECT * FROM ritual_actions WHERE type='incense' AND status='QUEUED' AND phase IN ('PENDING','TO_QUEUE','WAITING') ORDER BY sequence LIMIT $1",
      [c.movement.physicalQueueLimit],
    )
  ).rows;
  for (let slot = 0; slot < queued.length; slot++) {
    const a = queued[slot],
      e = (await tx.query('SELECT * FROM room_entries WHERE id=$1', [a.entry_id])).rows[0];
    if (!byEntry.has(e.id) || e.movement_path || a.queue_slot === slot) continue;
    try {
      await planMovement(tx, c, e, `queue:${slot}`, 'INCENSE_WALKING');
      await tx.query(
        "UPDATE ritual_actions SET phase='TO_QUEUE',queue_slot=$2,called_at=coalesce(called_at,clock_timestamp()) WHERE id=$1",
        [a.id, slot],
      );
      await tx.query(
        "UPDATE room_entries SET ritual_protected_until=coalesce(ritual_protected_until,clock_timestamp()+$2*interval '1 minute') WHERE id=$1",
        [e.id, c.movement.ritualProtectionMinutes],
      );
      dirty = true;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  return dirty;
}
