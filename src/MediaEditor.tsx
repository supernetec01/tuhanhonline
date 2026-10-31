import { useEffect, useState, useRef } from 'react';
import { audioCues, audioCueLabels, audioGroups, v2FileCues } from '../server/audio-config';
import { api } from './api';
import { type Settings } from '../server/config';
export function MediaEditor({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (c: Settings) => void;
}) {
  const [assets, setAssets] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState('voice'),
    [showArchived, setShowArchived] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  async function load() {
    setAssets((await api('/admin/media')).assets);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="admin-panel">
      <h2>Thư viện âm thanh có phiên bản</h2>
      <p>
        Import nhiều file OGG/MP3. Voice được đo bằng ffprobe, tối đa 10 giây/file; mỗi lần thay tạo
        phiên bản mới. Chọn bản thu rồi lưu nháp → xem trước → xuất bản.
      </p>
      <select aria-label="Loại bản thu" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="voice">Voice ≤10s</option>
        <option value="sfx">SFX ≤60s</option>
        <option value="music">Nhạc ≤10 phút</option>
      </select>
      <input
        aria-label="Import bản thu"
        type="file"
        accept="audio/ogg,audio/mpeg,.ogg,.mp3"
        multiple
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError('');
          try {
            for (const file of Array.from(e.target.files ?? [])) {
              if (file.size > 2500000) throw new Error(file.name + ': tối đa 2.5 MB');
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = () => reject(new Error('Không đọc được tệp'));
                reader.readAsDataURL(file);
              });
              await api('/admin/media/upload', { kind, title: file.name, data });
            }
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <p role="status">{busy ? 'Đang kiểm tra & import…' : error}</p>
      <label>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Hiện bản thu đã ẩn
      </label>
      <p>
        Ẩn khỏi thư viện giữ file và lịch sử phiên bản. Muốn ngừng phát, bỏ gán sự kiện rồi xuất
        bản.
      </p>
      <details
        onPlayCapture={(e) => {
          const audio = e.target as HTMLAudioElement;
          if (audio.tagName === 'AUDIO')
            e.currentTarget.querySelectorAll('audio').forEach((a) => {
              if (a !== audio) a.pause();
            });
        }}
      >
        <summary>Danh sách & nghe thử ({assets.length})</summary>
        {assets
          .filter((a) => showArchived || !a.archived_at)
          .map((a) => (
            <div key={a.id}>
              <strong>
                {a.title} · {a.duration_ms}ms
              </strong>
              <audio controls preload="none" src={'/api/admin/media/' + a.id} />
              <button
                type="button"
                onClick={() =>
                  void api('/admin/media/archive', { id: a.id, archived: !a.archived_at })
                    .then(load)
                    .catch((e) => setError(e.message))
                }
              >
                {a.archived_at ? 'Khôi phục vào thư viện' : 'Ẩn bản thu'}
              </button>
            </div>
          ))}
      </details>
      <h3>Thiền Tĩnh V2 · Import trọn bộ 14 OGG</h3>
      <p>
        Giải nén ZIP và chọn đủ 14 file theo manifest. Chỉ gán vào bản đang sửa khi mọi file import
        thành công; chưa xuất bản tự động. Thiếu file sẽ giữ mapping cũ.
      </p>
      <input
        aria-label="Import Thiền Tĩnh V2"
        type="file"
        multiple
        accept=".ogg,audio/ogg"
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError('');
          try {
            const files = Array.from(e.target.files ?? []),
              expected = Object.keys(v2FileCues);
            if (
              files.length !== expected.length ||
              new Set(files.map((f) => f.name)).size !== expected.length ||
              expected.some((name) => !files.some((f) => f.name === name))
            )
              throw new Error('Cần đủ 14 file OGG đúng tên trong manifest V2.');
            if (files.some((f) => f.size > 2500000)) throw new Error('Mỗi file tối đa 2.5 MB.');
            const mapping = { ...latest.current.audio };
            for (const file of files) {
              const cue = v2FileCues[file.name],
                kind = cue === 'background' || cue === 'waitingBackground' ? 'music' : 'sfx';
              const data = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(',')[1]);
                r.onerror = () => reject(new Error('Không đọc được tệp'));
                r.readAsDataURL(file);
              });
              const asset = await api('/admin/media/upload', { kind, title: file.name, data });
              mapping[cue] = asset.id;
            }
            onChange({ ...latest.current, audio: mapping });
            await load();
            setError(
              'Đã import 14 file và gán vào bản đang sửa. Hãy nghe thử, lưu nháp và xuất bản.',
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <h3>Âm lượng mặc định và sự kiện</h3>
      {audioGroups.map((group) => (
        <label key={group}>
          {group} · {Math.round(value.audioMix.volumes[group] * 100)}%
          <input
            aria-label={'Mặc định ' + group}
            type="range"
            min="0"
            max="1"
            step=".01"
            value={value.audioMix.volumes[group]}
            onChange={(e) =>
              onChange({
                ...value,
                audioMix: {
                  ...value.audioMix,
                  volumes: { ...value.audioMix.volumes, [group]: Number(e.target.value) },
                },
              })
            }
          />
        </label>
      ))}
      <label>
        Nhạc còn lại khi voice phát · {Math.round(value.audioMix.duckFactor * 100)}% mức hiện tại
        <input
          type="range"
          min="0"
          max="1"
          step=".01"
          value={value.audioMix.duckFactor}
          onChange={(e) =>
            onChange({
              ...value,
              audioMix: { ...value.audioMix, duckFactor: Number(e.target.value) },
            })
          }
        />
      </label>
      <label>
        Crossfade (giây)
        <input
          type="number"
          min=".1"
          max="5"
          step=".1"
          value={value.audioMix.crossfadeSeconds}
          onChange={(e) =>
            onChange({
              ...value,
              audioMix: { ...value.audioMix, crossfadeSeconds: Number(e.target.value) },
            })
          }
        />
      </label>
      <label>
        Tối đa hiệu ứng đồng thời
        <select
          value={value.audioMix.maxEffects}
          onChange={(e) =>
            onChange({
              ...value,
              audioMix: { ...value.audioMix, maxEffects: Number(e.target.value) },
            })
          }
        >
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.audioMix.coinEnabled}
          onChange={(e) =>
            onChange({ ...value, audioMix: { ...value.audioMix, coinEnabled: e.target.checked } })
          }
        />
        Phát tiếng nhận xu (gộp, tối đa 1 lần/5 giây)
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.audioMix.woodblockEnabled}
          onChange={(e) =>
            onChange({
              ...value,
              audioMix: { ...value.audioMix, woodblockEnabled: e.target.checked },
            })
          }
        />
        Mõ nhẹ cùng nghi lễ (không chạy lặp)
      </label>
      {audioCues.map((key) => (
        <label key={key}>
          {audioCueLabels[key]}
          <select
            value={value.audio[key] ?? ''}
            onChange={(e) => {
              const audio = { ...value.audio };
              if (e.target.value) audio[key] = e.target.value;
              else delete audio[key];
              onChange({ ...value, audio });
            }}
          >
            <option value="">Chưa gán / tắt sự kiện</option>
            {assets
              .filter((a) => a.kind !== 'voice' && (!a.archived_at || value.audio[key] === a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} · {a.duration_ms}ms
                </option>
              ))}
          </select>
        </label>
      ))}
      <h3>Thư viện lời chúc ({value.blessings.length})</h3>
      <p>
        Import JSON dạng danh sách {'{id, text, audioId: null}'}; không giả định có 48 bản thu.
        Nickname hiển thị bằng chữ, file cố định không đọc tên.
      </p>
      <input
        aria-label="Import lời chúc JSON"
        type="file"
        accept="application/json,.json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 100000) throw new Error('JSON tối đa 100 KB');
            const { settingsSchema } = await import('../server/config');
            const parsed = settingsSchema.parse({
              ...value,
              blessings: JSON.parse(await f.text()),
            });
            onChange(parsed);
            setError('Đã import vào bản nháp đang sửa.');
          } catch {
            setError('JSON không đúng schema id/text/audioId hoặc vượt giới hạn.');
          }
        }}
      />
      {value.blessings.map((b, i) => (
        <label key={b.id}>
          {b.text}
          <select
            value={b.audioId ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                blessings: value.blessings.map((v, n) =>
                  n === i ? { ...v, audioId: e.target.value || null } : v,
                ),
              })
            }
          >
            <option value="">Chỉ chữ</option>
            {assets
              .filter((a) => a.kind === 'voice')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
          </select>
        </label>
      ))}
      <h3>Trang phục</h3>
      {value.shop.map((o, i) => (
        <div key={o.id}>
          <label>
            {o.id} · Tên
            <input
              value={o.name}
              onChange={(e) =>
                onChange({
                  ...value,
                  shop: value.shop.map((v, n) => (n === i ? { ...v, name: e.target.value } : v)),
                })
              }
            />
          </label>
          <label>
            Giá xu
            <input
              type="number"
              min="0"
              max="100000"
              value={o.price}
              onChange={(e) =>
                onChange({
                  ...value,
                  shop: value.shop.map((v, n) =>
                    n === i ? { ...v, price: Number(e.target.value) } : v,
                  ),
                })
              }
            />
          </label>
        </div>
      ))}
    </section>
  );
}
