import { renderToStaticMarkup } from 'react-dom/server';
import { ProductArt } from './StoreArt';
import { type Product } from '../server/store-config';
export async function buildStoreAtlas(products: Product[]) {
  const canvas = document.createElement('canvas'),
    cellW = 240,
    cellH = 280,
    columns = 8;
  canvas.width = cellW * columns;
  canvas.height = cellH * Math.ceil(products.length / columns);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas atlas unavailable');
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {};
  await Promise.all(
    products.map(async (item, index) => {
      const img = new Image();
      const source = item.imageId
        ? `/api/store/assets/${item.imageId}`
        : 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(renderToStaticMarkup(<ProductArt item={item} />));
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Không tải được ảnh vật phẩm ' + item.name));
        img.src = source;
      });
      const x = (index % columns) * cellW,
        y = Math.floor(index / columns) * cellH,
        w = item.category === 'dotStyle' ? 48 : 240,
        h = item.category === 'nameFrame' ? 64 : item.category === 'dotStyle' ? 48 : 280;
      context.drawImage(img, x, y, w, h);
      frames[item.id] = { frame: { x, y, w, h } };
    }),
  );
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = canvas.toDataURL('image/png');
  });
  return { image, data: { frames } };
}
