import { useEffect, useState } from 'react';
import { TempleAudioManager } from './AudioManager';
import { audioGroups, type AudioGroup } from '../server/audio-config';
const labels: Record<AudioGroup, string> = {
  templeAmbient: 'Nhạc chánh điện',
  waitingAmbient: 'Nhạc sảnh chờ',
  ritualEffects: 'Hiệu ứng nghi lễ',
  uiEffects: 'Thông báo và thao tác',
  voice: 'Voice lời chúc',
};
export function useAudioState(manager: TempleAudioManager) {
  const [state, setState] = useState(manager.state);
  useEffect(() => {
    setState(manager.state);
    return manager.subscribe(() => setState(manager.state));
  }, [manager]);
  return state;
}
export function AudioControls({ manager }: { manager: TempleAudioManager }) {
  const state = useAudioState(manager),
    [error, setError] = useState('');
  return (
    <>
      <p>
        Nhạc phát tại trình duyệt, dùng chung khi mở chat, cửa hàng và bảng xếp hạng. Thiết lập âm
        lượng và tắt tiếng được lưu trên thiết bị.
      </p>
      <button
        className="game-primary"
        onClick={() => {
          if (state.playing) manager.pause();
          else void manager.resume();
        }}
      >
        {state.playing ? 'Tạm dừng nhạc' : 'Bật / tiếp tục âm thanh'}
      </button>
      <label className="game-check">
        <input
          type="checkbox"
          checked={state.muted}
          onChange={(e) => manager.setMuted(e.target.checked)}
        />
        Tắt tiếng
      </label>
      {audioGroups.map((group) => (
        <label key={group}>
          {labels[group]} · {Math.round(state.volumes[group] * 100)}%
          <input
            aria-label={labels[group]}
            type="range"
            min="0"
            max="1"
            step=".01"
            value={state.volumes[group]}
            onChange={(e) => manager.setVolume(group, Number(e.target.value))}
          />
        </label>
      ))}
      <button className="text-link" onClick={() => manager.resetVolumes()}>
        Khôi phục âm lượng từ Admin
      </button>
      {state.needsGesture && (
        <p>Trình duyệt đã tạm dừng âm thanh. Chạm bật / tiếp tục để phát lại.</p>
      )}
      {state.unlocked && !state.ambient && !state.error && (
        <p className="form-hint">
          Đã cho phép âm thanh; chưa có bản nền đang phát. Admin cần gán và xuất bản file âm thanh.
        </p>
      )}
      <details>
        <summary>Bản thu riêng trên thiết bị</summary>
        <label>
          Chọn bản thu riêng
          <input
            type="file"
            accept="audio/ogg,audio/mpeg,audio/wav"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void manager.customTrack(f).catch((e) => setError(e.message));
            }}
          />
        </label>
        <p>{state.customTrack || 'Chưa chọn bản thu riêng.'}</p>
        <p className="form-hint">
          Bản riêng thay nền tự động, chỉ phát trên máy bạn và không tải lên server.
        </p>
        <button className="text-link" onClick={() => manager.clearCustomTrack()}>
          Dùng lại nền chánh điện / sảnh chờ
        </button>
      </details>
      {(state.error || error) && <p role="alert">{error || state.error}</p>}
    </>
  );
}
