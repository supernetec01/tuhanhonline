import { z } from 'zod';
export const npcSchema = z
  .object({
    mode: z.enum(['fill', 'half', 'off']).default('fill'),
    maxCount: z.number().int().min(0).max(72).default(72),
    motion: z.enum(['static', 'light', 'medium']).default('light'),
    fadeMs: z.number().int().min(300).max(500).default(400),
    returnDelaySeconds: z.number().min(3).max(5).default(4),
    seed: z.number().int().min(0).max(100000).default(11),
  })
  .strict()
  .default(() => ({
    mode: 'fill' as const,
    maxCount: 72,
    motion: 'light' as const,
    fadeMs: 400,
    returnDelaySeconds: 4,
    seed: 11,
  }));
export type NpcSettings = z.infer<typeof npcSchema>;
export type NpcSeat = { id: number; enabled: boolean; player: unknown; reserved: boolean };
export function selectNpcSeats(seats: readonly NpcSeat[], settings: NpcSettings): number[] {
  if (settings.mode === 'off' || settings.maxCount === 0) return [];
  const free = seats.filter((s) => s.enabled && !s.player && !s.reserved);
  const count = Math.min(
    settings.maxCount,
    settings.mode === 'half' ? Math.floor(free.length / 2) : free.length,
  );
  return free
    .toSorted(
      (a, b) =>
        (Math.imul(a.id + settings.seed, 2654435761) >>> 0) -
          (Math.imul(b.id + settings.seed, 2654435761) >>> 0) || a.id - b.id,
    )
    .slice(0, count)
    .map((s) => s.id);
}
export type SeatLayout = { id: number; x: number; y: number; scale: number; enabled: boolean };
export function standardSeatLayout(count: 36 | 72): SeatLayout[] {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 6);
    return {
      id: i + 1,
      x:
        50 +
        ([18, 29, 40, 60, 71, 82][i % 6] - 50) *
          (count === 36 ? 0.65 + row * 0.08 : 0.65 + row * 0.035),
      y: 52.7 + row * (count === 36 ? 7.5 : 3.4),
      scale: count === 36 ? 4.2 + row * 0.35 : 2.6 + row * 0.06,
      enabled: true,
    };
  });
}
export function expandLegacySeats(rows: SeatLayout[]): SeatLayout[] {
  return rows.length === 36
    ? [
        ...rows,
        ...standardSeatLayout(72)
          .slice(36)
          .map((s) => ({ ...s, enabled: false })),
      ]
    : rows;
}
