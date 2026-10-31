import { selectNpcSeats, type NpcSeat, type NpcSettings } from '../server/npc-config';
export type NpcActor = {
  seatId: number;
  phase: 'visible' | 'yielding';
  since: number;
  alpha: number;
};
// Visual state only. No account, reservation, heartbeat, API command or currency exists here.
export class VirtualNpcState {
  readonly actors = new Map<number, NpcActor>();
  private occupied = new Map<number, boolean>();
  private returnAt = new Map<number, number>();
  private humanAfter = new Map<number, number>();
  step(seats: readonly NpcSeat[], settings: NpcSettings, now: number, reduceMotion = false) {
    const desired = new Set(selectNpcSeats(seats, settings)),
      fade = reduceMotion ? 0 : settings.fadeMs,
      ids = new Set(seats.map((s) => s.id));
    for (const s of seats) {
      const busy = !s.enabled || !!s.player || s.reserved,
        previous = this.occupied.get(s.id);
      if (previous === true && !busy)
        this.returnAt.set(s.id, now + settings.returnDelaySeconds * 1000);
      if (busy) this.returnAt.delete(s.id);
      this.occupied.set(s.id, busy);
      const eligible = desired.has(s.id) && !busy && now >= (this.returnAt.get(s.id) ?? 0);
      let actor = this.actors.get(s.id);
      if (actor && !eligible) {
        if (actor.phase !== 'yielding') {
          actor.phase = 'yielding';
          actor.since = now;
        }
        if (s.player || s.reserved) this.humanAfter.set(s.id, actor.since + fade);
      }
      if (actor?.phase === 'yielding') {
        actor.alpha = fade ? Math.max(0, 1 - (now - actor.since) / fade) : 0;
        if (actor.alpha === 0) {
          this.actors.delete(s.id);
          actor = undefined;
        }
      }
      if (!actor && eligible) {
        actor = { seatId: s.id, phase: 'visible', since: now, alpha: fade ? 0 : 1 };
        this.actors.set(s.id, actor);
      }
      if (actor?.phase === 'visible')
        actor.alpha = fade ? Math.min(1, Math.max(0, (now - actor.since) / fade)) : 1;
    }
    for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    for (const map of [this.occupied, this.returnAt, this.humanAfter])
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    for (const [id, at] of this.humanAfter) if (now >= at) this.humanAfter.delete(id);
    return this.actors;
  }
  humanAlpha(seatId: number, now: number) {
    return now < (this.humanAfter.get(seatId) ?? 0) ? 0 : 1;
  }
  get visibleCount() {
    return [...this.actors.values()].filter((a) => a.alpha > 0 && a.phase === 'visible').length;
  }
}
export function npcPoses(
  ids: number[],
  now: number,
  motion: NpcSettings['motion'],
  staticMode = false,
) {
  const poses = new Map<number, { action: 'idle' | 'bow' | 'prostrate'; scaleY: number }>();
  if (staticMode || motion === 'static') return poses;
  const cycle = motion === 'medium' ? 30000 : 45000,
    epoch = Math.floor(now / cycle),
    t = now % cycle,
    bowing = t >= 6000 && t < 8000,
    prostrating = t >= 20000 && t < 24000;
  if (!ids.length || (!bowing && !prostrating)) return poses;
  const count = Math.min(
    ids.length,
    bowing ? (motion === 'medium' ? 4 : 2) : motion === 'medium' ? 2 : 1,
  );
  for (let i = 0; i < count; i++) {
    const id = ids[(epoch * 5 + i) % ids.length];
    const progress = bowing ? (t - 6000) / 2000 : (t - 20000) / 4000;
    poses.set(id, {
      action: bowing ? 'bow' : 'prostrate',
      scaleY: 1 - (bowing ? 0.18 : 0.45) * Math.sin(progress * Math.PI),
    });
  }
  return poses;
}
