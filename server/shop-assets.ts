import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Pool } from 'pg';
import { ApiError, transaction } from './db.js';
const run = promisify(execFile);
export class ShopAssets {
  constructor(readonly pool: Pool) {}
  async upload(actor: string, data: string) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new ApiError(400, 'IMAGE_ENCODING', 'Tệp không hợp lệ.');
    const bytes = Buffer.from(data, 'base64'),
      png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      webp =
        bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (bytes.length > 1500000 || (!png && !webp))
      throw new ApiError(400, 'IMAGE_FORMAT', 'Chỉ PNG/WebP, tối đa 1.5 MB.');
    const dir = process.env.SHOP_ASSET_DIR ?? '.data/shop-assets',
      id = randomUUID(),
      file = `${id}.${png ? 'png' : 'webp'}`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(`${dir}/${file}`, bytes, { flag: 'wx', mode: 0o600 });
    try {
      let parsed;
      try {
        parsed = JSON.parse(
          (
            await run(
              'ffprobe',
              [
                '-v',
                'error',
                '-count_frames',
                '-show_entries',
                'stream=codec_name,width,height,nb_read_frames',
                '-of',
                'json',
                `${dir}/${file}`,
              ],
              { timeout: 10000, maxBuffer: 16384 },
            )
          ).stdout,
        );
      } catch {
        throw new ApiError(400, 'IMAGE_DECODE', 'Không đọc được ảnh.');
      }
      const s = parsed.streams?.[0];
      if (
        parsed.streams?.length !== 1 ||
        !s ||
        !['png', 'webp'].includes(s.codec_name) ||
        !s.width ||
        !s.height ||
        s.width > 1024 ||
        s.height > 1024 ||
        Number(s.nb_read_frames) !== 1
      )
        throw new ApiError(400, 'IMAGE_DIMENSIONS', 'Ảnh tĩnh 1–1024px, chỉ một frame.');
      await transaction(this.pool, async (tx) => {
        await tx.query(
          'INSERT INTO shop_assets(id,file_name,mime,width,height,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            id,
            file,
            png ? 'image/png' : 'image/webp',
            s.width,
            s.height,
            createHash('sha256').update(bytes).digest('hex'),
            actor,
          ],
        );
        await tx.query(
          "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'store.image.upload',$2)",
          [actor, JSON.stringify({ id, width: s.width, height: s.height })],
        );
      });
      return { id, width: s.width, height: s.height };
    } catch (e) {
      await rm(`${dir}/${file}`, { force: true });
      throw e;
    }
  }
  async file(id: string) {
    const a = (await this.pool.query('SELECT * FROM shop_assets WHERE id=$1', [id])).rows[0];
    if (!a) throw new ApiError(404, 'IMAGE_MISSING', 'Không tìm thấy ảnh.');
    return {
      mime: a.mime,
      bytes: await readFile(`${process.env.SHOP_ASSET_DIR ?? '.data/shop-assets'}/${a.file_name}`),
    };
  }
}
