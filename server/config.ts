import { npcSchema, standardSeatLayout, expandLegacySeats } from './npc-config.js';
import { audioCues, audioMixSchema } from './audio-config.js';
import { storeSchema } from './store-config.js';
import { catalog } from './catalog.js';
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
    npc: npcSchema,
    store: storeSchema,
    live: liveSettingsSchema.default(() => liveSettingsSchema.parse({})),
    audio: z.partialRecord(z.enum(audioCues), z.uuid()).default({}),
    audioMix: audioMixSchema,
    blessings: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
            text: safeText(240),
            audioId: z.uuid().nullable(),
          })
          .strict(),
      )
      .max(200)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length)
      .default([]),
    shop: z
      .array(
        z
          .object({
            id: z.enum(['linen', 'saffron', 'lotus', 'cloud']),
            name: safeText(60),
            subtitle: safeText(120),
            price: z.number().int().min(0).max(100000),
            color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            accent: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            collection: safeText(60),
          })
          .strict(),
      )
      .length(4)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === 4)
      .default(catalog.map((o) => ({ ...o, id: o.id as 'linen' | 'saffron' | 'lotus' | 'cloud' }))),
    chat: z
      .object({
        mode: z.enum(['open', 'read-only', 'disabled']).default('open'),
        rejectedTerms: z.array(safeText(60)).max(100).default(['địt mẹ', 'đụ má']),
        allowlist: z.array(safeText(150)).max(100).default([]),
        reviewTerms: z.array(safeText(60)).max(100).default(['tự tử', 'giết']),
      })
      .strict()
      .default(() => ({
        mode: 'open' as const,
        rejectedTerms: ['địt mẹ', 'đụ má'],
        allowlist: [],
        reviewTerms: ['tự tử', 'giết'],
      })),
    dailyCoinCap: z.number().int().min(1).max(1440).default(240),
    dotPrices: z
      .array(z.number().int().min(0).max(100000))
      .length(4)
      .default([200, 500, 1000, 2000]),
    ritualMerit: z
      .object({
        bow: z.number().int().min(0).max(100),
        prostrate: z.number().int().min(0).max(100),
        incense: z.number().int().min(0).max(100),
      })
      .strict()
      .default({ bow: 1, prostrate: 3, incense: 10 }),
    prayerTemplates: z
      .array(safeText(120))
      .min(1)
      .max(30)
      .default(['Cầu bình an', 'Cầu sức khỏe', 'Cầu gia đình an vui']),
    lighting: z.enum(['auto', 'day', 'night']).default('auto'),
    waitingDisplayLimit: z.number().int().min(0).max(18).default(18),
    title: safeText(60),
    tagline: safeText(120),
    roomName: safeText(60),
    announcement: z
      .string()
      .max(200)
      .refine((v) => !/[<>\u0000-\u001f]/.test(v)),
    capacity: z.number().int().min(1).max(72),
    sessionMinutes: z.number().int().min(5).max(120),
    invitationSeconds: z.number().int().min(15).max(120),
    graceSeconds: z.number().int().min(30).max(300),
    bowCooldown: z.number().int().min(3).max(60),
    prostrateCooldown: z.number().int().min(5).max(600),
    incenseCooldown: z.number().int().min(30).max(600),
    incenseDuration: z.number().int().min(5).max(30),
    actionsEnabled: z.boolean(),
    blessing: safeText(240).refine((v) => v.includes('{name}'), 'Mẫu câu cần có {name}'),
    ttsInterval: z.number().int().min(10).max(120),
    seatLayout: z
      .array(
        z
          .object({
            id: z.number().int().min(1).max(72),
            x: z.number().min(5).max(95),
            y: z.number().min(48).max(94),
            scale: z.number().min(2).max(12),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .refine(
        (rows) =>
          (rows.length === 36 || rows.length === 72) &&
          new Set(rows.map((r) => r.id)).size === rows.length &&
          rows.every((r) => r.id <= rows.length),
        'Cần đủ ID 1–36 hoặc 1–72',
      )
      .transform(expandLegacySeats),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  npc: npcSchema.parse({}),
  store: storeSchema.parse({}),
  live: liveSettingsSchema.parse({}),
  title: 'Tu Hành Online',
  tagline: 'Một mái chùa nhỏ, một khoảng lặng dành riêng cho bạn.',
  roomName: 'Chánh điện An Lạc',
  announcement: '',
  capacity: 36,
  sessionMinutes: 30,
  invitationSeconds: 60,
  graceSeconds: 120,
  audio: {},
  audioMix: audioMixSchema.parse({}),
  blessings: [],
  shop: catalog as Settings['shop'],
  chat: {
    allowlist: [],
    mode: 'open',
    rejectedTerms: ['địt mẹ', 'đụ má'],
    reviewTerms: ['tự tử', 'giết'],
  },
  dailyCoinCap: 240,
  dotPrices: [200, 500, 1000, 2000],
  ritualMerit: { bow: 1, prostrate: 3, incense: 10 },
  prayerTemplates: ['Cầu bình an', 'Cầu sức khỏe', 'Cầu gia đình an vui'],
  lighting: 'auto',
  waitingDisplayLimit: 18,
  bowCooldown: 60,
  prostrateCooldown: 180,
  incenseCooldown: 300,
  incenseDuration: 5,
  actionsEnabled: true,
  blessing:
    'Cảm ơn {name} đã gửi quà. Chúc bạn và gia đình luôn bình an, mạnh khỏe và tâm hồn thanh thản.',
  ttsInterval: 10,
  seatLayout: standardSeatLayout(36),
};
