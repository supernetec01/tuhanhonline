import { useState } from 'react';
import { type Settings } from '../server/config';
import { Experience } from './Experience';
import { TempleArt } from './Art';
export function LiveEditor({
  value,
  onChange,
}: {
  value: Settings['live'];
  onChange: (v: Settings['live']) => void;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <section className="live-editor">
      <h3>Hiệu ứng LIVE & thời khắc bình an</h3>
      <p>
        Cấu hình bên dưới dùng chung nút lưu nháp / xuất bản / khôi phục. Quà không ảnh hưởng ghế.
      </p>
      <div className="admin-fields">
        <label className="check-label">
          <input
            type="checkbox"
            checked={value.showNames}
            onChange={(e) => onChange({ ...value, showNames: e.target.checked })}
          />
          Hiện pháp danh nhân vật
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={value.ttsEnabled}
            onChange={(e) => onChange({ ...value, ttsEnabled: e.target.checked })}
          />
          Xếp hàng đọc lời chúc
        </label>
        <label>
          Giọng AI (chỉ khi cấu hình TTS thật)
          <select
            value={value.voice}
            onChange={(e) => onChange({ ...value, voice: e.target.value as 'coral' | 'onyx' })}
          >
            <option value="coral">Coral</option>
            <option value="onyx">Onyx</option>
          </select>
        </label>
        <label>
          Âm lượng nhạc khi có lời chúc
          <input
            type="number"
            min="0"
            max="1"
            step=".05"
            value={value.duckVolume}
            onChange={(e) => onChange({ ...value, duckVolume: Number(e.target.value) })}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={value.ceremonyEnabled}
            onChange={(e) => onChange({ ...value, ceremonyEnabled: e.target.checked })}
          />
          Tự động thiền chung miễn phí
        </label>
        <label>
          Chu kỳ thiền chung (phút)
          <input
            type="number"
            min="10"
            max="15"
            value={value.ceremonyIntervalMinutes}
            onChange={(e) =>
              onChange({ ...value, ceremonyIntervalMinutes: Number(e.target.value) })
            }
          />
        </label>
      </div>
      {value.effects.map((rule, i) => (
        <div className="effect-rule" key={i}>
          <input
            aria-label={`Mã quà ${i + 1}`}
            value={rule.giftId}
            maxLength={50}
            onChange={(e) =>
              onChange({
                ...value,
                effects: value.effects.map((r, n) =>
                  n === i ? { ...r, giftId: e.target.value } : r,
                ),
              })
            }
          />
          <select
            aria-label={`Hiệu ứng ${i + 1}`}
            value={rule.kind}
            onChange={(e) =>
              onChange({
                ...value,
                effects: value.effects.map((r, n) =>
                  n === i ? { ...r, kind: e.target.value as typeof r.kind } : r,
                ),
              })
            }
          >
            <option value="lotus">Hoa sen</option>
            <option value="lantern">Đèn bình an</option>
            <option value="incense">Khói hương</option>
          </select>
          <input
            type="number"
            aria-label={`Thời lượng hiệu ứng ${i + 1}`}
            min="2"
            max="8"
            value={rule.durationSeconds}
            onChange={(e) =>
              onChange({
                ...value,
                effects: value.effects.map((r, n) =>
                  n === i ? { ...r, durationSeconds: Number(e.target.value) } : r,
                ),
              })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  effects: value.effects.map((r, n) =>
                    n === i ? { ...r, enabled: e.target.checked } : r,
                  ),
                })
              }
            />
            Bật
          </label>
          <label>
            <input
              type="checkbox"
              checked={rule.showName}
              onChange={(e) =>
                onChange({
                  ...value,
                  effects: value.effects.map((r, n) =>
                    n === i ? { ...r, showName: e.target.checked } : r,
                  ),
                })
              }
            />
            Hiện tên
          </label>
        </div>
      ))}
      <button className="subtle-button" onClick={() => setPreview(!preview)}>
        Xem trước hiệu ứng bản nháp
      </button>
      {preview && (
        <div className="scene" style={{ maxWidth: 420 }}>
          <TempleArt />
          <Experience
            room={
              {
                effect: {
                  id: 'preview',
                  kind: value.effects[0]?.kind ?? 'lotus',
                  name: 'Người hữu duyên',
                  show_name: true,
                  ends_at: new Date(Date.now() + 60000).toISOString(),
                },
                clockOffsetMs: 0,
              } as any
            }
          />
        </div>
      )}
    </section>
  );
}
