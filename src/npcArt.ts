import { type Product } from '../server/store-config';
const basic = (id: string, color: string, category: 'robe' | 'seat' = 'robe'): Product => ({
  id,
  category,
  name: 'NPC hệ thống',
  description: 'Nhân vật trang trí, không phải người chơi.',
  price: 0,
  tier: 1,
  color,
  accent: '#b9af98',
  design: category === 'robe' ? 'novice' : 'cushion',
  enabled: true,
  order: 0,
  imageId: null,
});
export const npcTextureProducts = [
  basic('@npc/xam', '#85868A'),
  basic('@npc/nau', '#877054'),
  basic('@npc/lam', '#8b9d9c'),
  basic('@npc/seat', '#877054', 'seat'),
];
export const npcRobe = (seatId: number, seed: number) => npcTextureProducts[(seatId + seed) % 3].id;
