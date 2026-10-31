import { renderToStaticMarkup } from 'react-dom/server';
import {
  PartDrawing,
  partBoxes,
  type BodyPart,
  type Facing,
  type AppearanceType,
} from './CharacterRig';
import { type Product } from '../server/store-config';
export const rigFrame = (
  robe: string,
  part: BodyPart,
  facing: Facing,
  appearance: AppearanceType,
) =>
  part === 'head'
    ? `head:${appearance}:${facing}`
    : `${robe}:${part === 'armRight' ? 'armLeft' : part === 'legRight' ? 'legLeft' : part}:${part === 'torso' ? facing : 'front'}`;
export async function buildRigAtlas(products: Product[]) {
  const entries: { id: string; svg: string; imageId?: string }[] = [];
  const add = (
    id: string,
    part: BodyPart,
    robe?: Product,
    facing: Facing = 'front',
    appearance: AppearanceType = 'male',
  ) => {
    const b = partBoxes[part];
    entries.push({
      id,
      imageId: part === 'torso' ? (robe?.imageId ?? undefined) : undefined,
      svg: renderToStaticMarkup(
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="256"
          height="256"
          viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
          preserveAspectRatio="none"
        >
          <PartDrawing
            part={part}
            color={robe?.color}
            accent={robe?.accent}
            design={robe?.design}
            facing={facing}
            appearance={appearance}
          />
        </svg>,
      ),
    });
  };
  for (const appearance of ['male', 'female'] as const)
    for (const facing of ['front', 'back', 'left', 'right'] as const)
      add(rigFrame('', 'head', facing, appearance), 'head', undefined, facing, appearance);
  for (const robe of products.filter((p) => p.category === 'robe')) {
    for (const facing of ['front', 'back', 'left', 'right'] as const)
      add(rigFrame(robe.id, 'torso', facing, 'male'), 'torso', robe, facing);
    for (const part of ['armLeft', 'legLeft'] as const)
      add(rigFrame(robe.id, part, 'front', 'male'), part, robe);
  }
  const canvas = document.createElement('canvas'),
    size = 256,
    cols = 8;
  canvas.width = cols * size;
  canvas.height = Math.ceil(entries.length / cols) * size;
  const ctx = canvas.getContext('2d')!;
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {};
  const customImages = new Map<string, Promise<HTMLImageElement>>();
  await Promise.all(
    entries.map(async (entry, i) => {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(entry.svg);
      });
      const x = (i % cols) * size,
        y = Math.floor(i / cols) * size;
      ctx.drawImage(img, x, y, size, size);
      if (entry.imageId) {
        let promise = customImages.get(entry.imageId);
        if (!promise) {
          const custom = new Image();
          promise = new Promise<HTMLImageElement>((resolve, reject) => {
            custom.onload = () => resolve(custom);
            custom.onerror = reject;
            custom.src = `/api/store/assets/${entry.imageId}`;
          });
          customImages.set(entry.imageId, promise);
        }
        const custom = await promise;
        // The garment stays inside the torso rectangle; it can never replace head, hands or feet.
        ctx.drawImage(
          custom,
          custom.width * 0.15,
          custom.height * 0.45,
          custom.width * 0.7,
          custom.height * 0.45,
          x + size * 0.08,
          y + size * 0.03,
          size * 0.84,
          size * 0.86,
        );
      }
      frames[entry.id] = { frame: { x, y, w: size, h: size } };
    }),
  );
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = canvas.toDataURL('image/png');
  });
  return {
    image,
    data: { frames },
    bytes: canvas.width * canvas.height * 4,
    frames: entries.length,
  };
}
