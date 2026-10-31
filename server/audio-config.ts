import { z } from 'zod';
export const audioGroups = [
  'templeAmbient',
  'waitingAmbient',
  'ritualEffects',
  'uiEffects',
  'voice',
] as const;
export type AudioGroup = (typeof audioGroups)[number];
export const audioCues = [
  'background',
  'waitingBackground',
  'welcome',
  'meditation',
  'woodblock',
  'bow',
  'prostrate',
  'incense',
  'seat',
  'invitation',
  'purchase',
  'coin',
  'blessing',
  'leave',
  'click',
  'chant',
] as const;
export type AudioCue = (typeof audioCues)[number];
export const audioMixSchema = z
  .object({
    volumes: z
      .object({
        templeAmbient: z.number().min(0).max(1).default(0.16),
        waitingAmbient: z.number().min(0).max(1).default(0.13),
        ritualEffects: z.number().min(0).max(1).default(0.3),
        uiEffects: z.number().min(0).max(1).default(0.22),
        voice: z.number().min(0).max(1).default(0.85),
      })
      .strict()
      .default(() => ({
        templeAmbient: 0.16,
        waitingAmbient: 0.13,
        ritualEffects: 0.3,
        uiEffects: 0.22,
        voice: 0.85,
      })),
    duckFactor: z.number().min(0).max(1).default(0.25),
    crossfadeSeconds: z.number().min(0.1).max(5).default(2),
    maxEffects: z.number().int().min(1).max(2).default(2),
    coinEnabled: z.boolean().default(false),
    woodblockEnabled: z.boolean().default(false),
  })
  .strict()
  .default(() => ({
    volumes: {
      templeAmbient: 0.16,
      waitingAmbient: 0.13,
      ritualEffects: 0.3,
      uiEffects: 0.22,
      voice: 0.85,
    },
    duckFactor: 0.25,
    crossfadeSeconds: 2,
    maxEffects: 2,
    coinEnabled: false,
    woodblockEnabled: false,
  }));
export type AudioMix = z.infer<typeof audioMixSchema>;
export const v2FileCues: Record<string, AudioCue> = {
  'ambient_chanh_dien_thien_tinh_90s.ogg': 'background',
  'ambient_sanh_cho_an_nhien_90s.ogg': 'waitingBackground',
  'chuong_chao_nhe.ogg': 'welcome',
  'chuong_tinh_tam.ogg': 'meditation',
  'mo_nhe.ogg': 'woodblock',
  'vai.ogg': 'bow',
  'lay.ogg': 'prostrate',
  'dang_huong.ogg': 'incense',
  'nhan_ghe.ogg': 'seat',
  'den_luot.ogg': 'invitation',
  'mua_vat_pham.ogg': 'purchase',
  'tich_xu.ogg': 'coin',
  'loi_chuc_mo_dau.ogg': 'blessing',
  'roi_phong.ogg': 'leave',
};
export const audioCueLabels: Record<AudioCue, string> = {
  background: 'Nền chánh điện',
  waitingBackground: 'Nền sảnh chờ',
  welcome: 'Chuông chào',
  meditation: 'Thiền chung',
  woodblock: 'Mõ nhẹ (tùy chọn)',
  bow: 'Vái bắt đầu',
  prostrate: 'Lạy bắt đầu',
  incense: 'Dâng hương hoàn tất',
  seat: 'Nhận ghế',
  invitation: 'Đến lượt',
  purchase: 'Mua vật phẩm',
  coin: 'Nhận xu (tùy chọn)',
  blessing: 'Mở lời chúc',
  leave: 'Rời phòng',
  click: 'Nút bấm (V1)',
  chant: 'Bản kinh riêng (V1)',
};
