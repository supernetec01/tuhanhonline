import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Pool } from 'pg';
import { ApiError, transaction } from './db.js';
const run = promisify(execFile);
export class MediaService {
  constructor(readonly pool: Pool) {}
  async upload(actor: string, kind: 'voice' | 'sfx' | 'music', title: string, data: string) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new ApiError(400, 'MEDIA_ENCODING', 'Tệp không hợp lệ.');
    const bytes = Buffer.from(data, 'base64');
    const ogg = bytes.subarray(0, 4).toString() === 'OggS',
      mp3 =
        bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
    if (bytes.length > 2500000 || (!ogg && !mp3))
      throw new ApiError(400, 'MEDIA_FORMAT', 'Chỉ nhận OGG/MP3, tối đa 2.5 MB.');
    const dir = process.env.MEDIA_DIR ?? '.data/assets',
      id = randomUUID(),
      temp = `${dir}/${id}.upload`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    try {
      let result;
      try {
        result = JSON.parse(
          (
            await run(
              'ffprobe',
              [
                '-v',
                'error',
                '-show_entries',
                'format=duration:stream=codec_type',
                '-of',
                'json',
                temp,
              ],
              { timeout: 10000, maxBuffer: 16384 },
            )
          ).stdout,
        );
      } catch {
        throw new ApiError(400, 'MEDIA_DECODE', 'Không đọc được audio bằng ffprobe.');
      }
      const duration = Number(result.format?.duration),
        durationMs = Math.ceil(duration * 1000);
      if (
        !Number.isFinite(duration) ||
        durationMs < 1 ||
        durationMs > (kind === 'voice' ? 10000 : kind === 'sfx' ? 60000 : 600000) ||
        !result.streams?.length ||
        result.streams.some((s: { codec_type: string }) => s.codec_type !== 'audio')
      )
        throw new ApiError(
          400,
          'MEDIA_DURATION',
          'Voice phải ≤10 giây, SFX ≤60 giây, nhạc ≤10 phút và chỉ chứa audio.',
        );
      const hash = createHash('sha256').update(bytes).digest('hex'),
        file = `${id}.${ogg ? 'ogg' : 'mp3'}`;
      await rename(temp, `${dir}/${file}`);
      try {
        await transaction(this.pool, async (tx) => {
          await tx.query(
            'INSERT INTO media_assets(id,kind,title,file_name,mime,duration_ms,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [id, kind, title, file, ogg ? 'audio/ogg' : 'audio/mpeg', durationMs, hash, actor],
          );
          await tx.query(
            "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'media.upload',$2)",
            [actor, JSON.stringify({ id, kind, title, durationMs, sha256: hash })],
          );
        });
      } catch (e) {
        await rm(`${dir}/${file}`, { force: true });
        throw e;
      }
      return { id, kind, title, durationMs };
    } finally {
      await rm(temp, { force: true });
    }
  }
  async file(id: string) {
    const asset = (await this.pool.query('SELECT * FROM media_assets WHERE id=$1', [id])).rows[0];
    if (!asset) throw new ApiError(404, 'MEDIA_MISSING', 'Không tìm thấy bản thu.');
    return {
      mime: asset.mime,
      bytes: await readFile(`${process.env.MEDIA_DIR ?? '.data/assets'}/${asset.file_name}`),
    };
  }
}
