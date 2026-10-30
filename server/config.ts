import { z } from 'zod';
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[<>\u0000-\u001f]/.test(v), 'Không dùng HTML hoặc ký tự điều khiển');
export const liveSettingsSchema = z
  .object({
    showNames: z.boolean().default(true),
    voice: z.enum(['coral', 'onyx']).default('coral'),
    ttsEnabled: z.boolean().default(true),
    effects: z
      .array(
        z
          .object({
            giftId: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
            kind: z.enum(['lotus', 'lantern', 'incense']),
            enabled: z.boolean(),
            durationSeconds: z.number().int().min(2).max(8),
            showName: z.boolean(),
          })
          .strict(),
      )
      .max(20)
      .refine((r) => new Set(r.map((x) => x.giftId)).size === r.length)
      .default([
        { giftId: 'rose', kind: 'lotus', enabled: true, durationSeconds: 4, showName: true },
        { giftId: 'lantern', kind: 'lantern', enabled: true, durationSeconds: 5, showName: true },
        { giftId: 'incense', kind: 'incense', enabled: true, durationSeconds: 5, showName: true },
      ]),
    ceremonyEnabled: z.boolean().default(false),
    ceremonyIntervalMinutes: z.number().int().min(10).max(15).default(15),
    duckVolume: z.number().min(0).max(1).default(0.2),
  })
  .strict();
export const settingsSchema = z
  .object({
    live: liveSettingsSchema.default(() => liveSettingsSchema.parse({})),
    title: safeText(60),
    tagline: safeText(120),
    roomName: safeText(60),
    announcement: z
      .string()
      .max(200)
      .refine((v) => !/[<>\u0000-\u001f]/.test(v)),
    capacity: z.number().int().min(1).max(36),
    sessionMinutes: z.number().int().min(5).max(120),
    invitationSeconds: z.number().int().min(15).max(120),
    graceSeconds: z.number().int().min(30).max(300),
    bowCooldown: z.number().int().min(3).max(60),
    prostrateCooldown: z.number().int().min(5).max(120),
    incenseCooldown: z.number().int().min(30).max(600),
    incenseDuration: z.number().int().min(5).max(30),
    actionsEnabled: z.boolean(),
    blessing: safeText(240).refine((v) => v.includes('{name}'), 'Mẫu câu cần có {name}'),
    ttsInterval: z.number().int().min(10).max(120),
    seatLayout: z
      .array(
        z
          .object({
            id: z.number().int().min(1).max(36),
            x: z.number().min(5).max(95),
            y: z.number().min(48).max(94),
            scale: z.number().min(4).max(12),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .length(36)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === 36, 'Cần đủ 36 vị trí khác nhau'),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  live: liveSettingsSchema.parse({}),
  title: 'Tu Hành Online',
  tagline: 'Một mái chùa nhỏ, một khoảng lặng dành riêng cho bạn.',
  roomName: 'Chánh điện An Lạc',
  announcement: '',
  capacity: 36,
  sessionMinutes: 30,
  invitationSeconds: 60,
  graceSeconds: 120,
  bowCooldown: 5,
  prostrateCooldown: 8,
  incenseCooldown: 180,
  incenseDuration: 15,
  actionsEnabled: true,
  blessing:
    'Cảm ơn {name} đã gửi quà. Chúc bạn và gia đình luôn bình an, mạnh khỏe và tâm hồn thanh thản.',
  ttsInterval: 10,
  seatLayout: Array.from({ length: 36 }, (_, i) => {
    const row = Math.floor(i / 6);
    return {
      id: i + 1,
      x: 50 + ([18, 29, 40, 60, 71, 82][i % 6] - 50) * (0.65 + row * 0.08),
      y: 52.7 + row * 7.5,
      scale: 5.7 + row * 1.02,
      enabled: true,
    };
  }),
};
