import { z } from 'zod';
export const categories = ['robe', 'seat', 'accessory', 'dotStyle', 'nameFrame'] as const;
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[<>\u0000-\u001f]/.test(v));
export const productSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
    category: z.enum(categories),
    name: text(60),
    description: text(240),
    price: z.number().int().min(0).max(100000),
    tier: z.number().int().min(1).max(6),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    design: z.enum([
      'novice',
      'long',
      'belt',
      'ceremony',
      'lotus',
      'jade',
      'cushion',
      'embroidered',
      'bamboo',
      'lantern',
      'purple',
      'nine',
      'beads',
      'book',
      'incense',
      'plain',
      'petal',
      'pearl',
      'metal',
      'wood',
    ]),
    enabled: z.boolean(),
    order: z.number().int().min(0).max(10000),
    imageId: z.uuid().nullable(),
  })
  .strict();
export type Product = z.infer<typeof productSchema>;
export type Cosmetics = { seat: string; accessory: string; dotStyle: string; nameFrame: string };
export type Appearance = { robe: string; cosmetics: Cosmetics };
export const baseCosmetics: Cosmetics = {
  seat: 'seat_moc',
  accessory: 'accessory_none',
  dotStyle: 'dots_brown',
  nameFrame: 'frame_none',
};
export const tierNames = [
  'Phàm Phục',
  'Thanh Tịnh',
  'An Nhiên',
  'Kim Liên',
  'Bạch Liên',
  'Liên Hoa Ngọc',
];
export const starterItems = ['linen', ...Object.values(baseCosmetics)];
const make = (
  id: string,
  category: Product['category'],
  name: string,
  price: number,
  tier: number,
  color: string,
  design: Product['design'],
  order: number,
  accent = '#e6d5ab',
): Product => ({
  id,
  category,
  name,
  description: 'Vật phẩm trang trí, không ảnh hưởng ghế hoặc phần thưởng.',
  price,
  tier,
  color,
  accent,
  design,
  enabled: true,
  order,
  imageId: null,
});
export const v9Products: Product[] = [
  make('robe_pham', 'robe', 'Phàm Phục', 0, 1, '#85868A', 'novice', 10),
  make('robe_thanh', 'robe', 'Áo Thanh Tịnh', 150, 2, '#877054', 'long', 20),
  make('robe_an', 'robe', 'Áo Nâu Thiền Hành', 450, 3, '#8C9368', 'belt', 30),
  make('robe_kim', 'robe', 'Pháp Phục Kim Liên', 1000, 4, '#D7A64C', 'ceremony', 40),
  make('robe_bach', 'robe', 'Áo Bạch Liên', 2000, 5, '#E4D8B9', 'lotus', 50),
  make('robe_ngoc', 'robe', 'Áo Thanh Liên Ngọc', 4000, 6, '#A79AC6', 'jade', 60),
  make('seat_moc', 'seat', 'Bồ Đoàn Mộc', 0, 1, '#877054', 'cushion', 10),
  make('seat_hoa', 'seat', 'Bồ Đoàn Hoa Văn', 150, 2, '#9f8065', 'embroidered', 20),
  make('seat_truc', 'seat', 'Trúc Thiền Tọa', 300, 2, '#8C9368', 'bamboo', 30),
  make('seat_hong', 'seat', 'Đài Sen Hồng', 500, 3, '#cb91a0', 'lotus', 40),
  make('seat_bach', 'seat', 'Bạch Liên Đài', 1000, 4, '#E4D8B9', 'lotus', 50),
  make('seat_dang', 'seat', 'Đăng Hoa Tọa', 1500, 4, '#d8b671', 'lantern', 60),
  make('seat_kim', 'seat', 'Kim Liên Đài', 2000, 5, '#D7A64C', 'lotus', 70),
  make('seat_tu', 'seat', 'Tử Liên Đài', 2500, 5, '#A79AC6', 'purple', 80),
  make('seat_ngoc', 'seat', 'Ngọc Liên Đài', 3500, 6, '#99beb1', 'jade', 90),
  make('seat_cuu', 'seat', 'Cửu Liên Đài', 5000, 6, '#ae9fc7', 'nine', 100),
  make('dots_brown', 'dotStyle', 'Chấm Nâu Truyền Thống', 0, 1, '#877054', 'plain', 10),
  make('dots_gold', 'dotStyle', 'Chấm Vàng Nhạt', 100, 2, '#e3c982', 'plain', 20),
  make('dots_petal', 'dotStyle', 'Chấm Cánh Sen', 250, 3, '#d6a9b3', 'petal', 30),
  make('dots_pearl', 'dotStyle', 'Chấm Ngọc Trắng', 450, 4, '#f6ebd8', 'pearl', 40),
  make('dots_metal', 'dotStyle', 'Chấm Ánh Kim Dịu', 800, 5, '#c7b58a', 'metal', 50),
  make('accessory_none', 'accessory', 'Không phụ kiện', 0, 1, '#877054', 'plain', 0),
  make('accessory_beads', 'accessory', 'Chuỗi Hạt Trầm', 200, 2, '#8e684b', 'beads', 10),
  make('accessory_lantern', 'accessory', 'Đèn Hoa Sen', 500, 3, '#d5aa67', 'lantern', 20),
  make('accessory_book', 'accessory', 'Kinh Sách Bên Tọa', 300, 2, '#9aac91', 'book', 30),
  make('accessory_incense', 'accessory', 'Lư Hương Mini', 700, 4, '#ac8c67', 'incense', 40),
  make('frame_none', 'nameFrame', 'Khung Giản Dị', 0, 1, '#e6c998', 'plain', 0),
  make('frame_bamboo', 'nameFrame', 'Khung Pháp Danh Trúc', 150, 2, '#8C9368', 'bamboo', 10),
  make('frame_lotus', 'nameFrame', 'Khung Pháp Danh Sen', 300, 3, '#cb91a0', 'lotus', 20),
  make('frame_wood', 'nameFrame', 'Khung Pháp Danh Gỗ', 150, 2, '#877054', 'wood', 30),
];
export const storeSchema = z
  .object({
    title: text(60).default('Bảo Các Thanh Liên'),
    products: z
      .array(productSchema)
      .min(25)
      .max(100)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, 'ID vật phẩm bị trùng')
      .refine(
        (rows) =>
          rows.every(
            (r) => !['linen', 'saffron', 'lotus', 'cloud'].includes(r.id) || r.category === 'robe',
          ),
        'Vật phẩm V8 phải giữ loại pháp phục',
      )
      .refine(
        (rows) =>
          Object.entries(baseCosmetics).every(([slot, id]) =>
            rows.some((r) => r.id === id && r.category === slot && r.price === 0),
          ),
        'Giữ vật phẩm mặc định miễn phí',
      )
      .default(v9Products),
  })
  .strict()
  .default(() => ({ title: 'Bảo Các Thanh Liên', products: v9Products }));

export function legacyProducts(
  items: {
    id: string;
    name: string;
    subtitle: string;
    price: number;
    color: string;
    accent: string;
  }[],
): Product[] {
  return items.map((o, i) => ({
    id: o.id,
    category: 'robe',
    name: o.name,
    description: o.subtitle,
    price: o.price,
    tier: i + 1,
    color: o.color,
    accent: o.accent,
    design: i === 1 ? 'ceremony' : i === 2 ? 'lotus' : i === 3 ? 'long' : 'novice',
    enabled: true,
    order: 900 + i,
    imageId: null,
  }));
}

export function combinedProducts(
  legacy: Parameters<typeof legacyProducts>[0],
  products: Product[],
): Product[] {
  return [
    ...legacyProducts(legacy).filter((p) => !products.some((v) => v.id === p.id)),
    ...products,
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
