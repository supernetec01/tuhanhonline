import { BroadcastAudioManager } from './AudioManager';
import { Experience } from './Experience';
import { useEffect, useRef, useState } from 'react';
import { api, type Outfit } from './api';
import { useTemple } from './useTemple';
import { Seats } from './Seats';
import { Lotus, TempleArt } from './Art';
export function Broadcast() {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [enabled, setEnabled] = useState(false),
    [deviceVoice, setDeviceVoice] = useState(false),
    [caption, setCaption] = useState(''),
    [error, setError] = useState(''),
    [outfits, setOutfits] = useState<Outfit[]>([]);
  const { room, gift } = useTemple(null);
  const playing = useRef(false);
  const background = useRef(new Audio());
  const mixer = useRef(new BroadcastAudioManager(background.current));
  const musicUrl = useRef('');
  useEffect(() => {
    mixer.current.setDuck(room?.config.live.duckVolume ?? 0.2);
  }, [room?.config.live.duckVolume]);
  useEffect(
    () => () => {
      background.current.pause();
      if (musicUrl.current) URL.revokeObjectURL(musicUrl.current);
    },
    [],
  );
  useEffect(() => {
    history.replaceState(null, '', location.pathname);
    void api('/catalog').then((d) => setOutfits(d.outfits));
  }, []);
  useEffect(() => {
    if (!enabled || !token) return;
    let mounted = true;
    const audio = new Audio();
    let cancelPlayback: (() => void) | null = null;
    async function next() {
      if (playing.current) return;
      playing.current = true;
      let job: any = null;
      let blobUrl: string | null = null;
      let watchdog: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await api('/broadcast/claim', {}, { 'X-Broadcast-Token': token });
        job = result.job;
        if (!job) return;
        if (!mounted) return;
        setCaption(job.text);
        mixer.current.setSpeaking(true);
        setError('');
        const interrupted = new Promise<void>((resolve) => {
          cancelPlayback = resolve;
          timeout = setTimeout(resolve, 80000);
        });
        watchdog = setInterval(() => {
          void api(`/broadcast/state/${job.id}`, undefined, { 'X-Broadcast-Token': token })
            .then((state) => {
              if (state.status !== 'PLAYING') {
                audio.pause();
                window.speechSynthesis?.cancel();
                setCaption('');
                cancelPlayback?.();
              }
            })
            .catch(() => {});
        }, 1000);
        if (job.mode === 'openai') {
          const response = await fetch(`/api/broadcast/audio/${job.id}`, {
            headers: { 'X-Broadcast-Token': token },
          });
          if (!response.ok) throw new Error('Không tải được giọng đọc AI.');
          blobUrl = URL.createObjectURL(await response.blob());
          audio.src = blobUrl;
          await Promise.race([
            interrupted,
            new Promise<void>((resolve, reject) => {
              audio.onended = () => resolve();
              audio.onerror = () => reject(new Error('Không phát được âm thanh.'));
              void audio.play().catch(reject);
            }),
          ]);
        } else if (deviceVoice && 'speechSynthesis' in window) {
          const voice = speechSynthesis
            .getVoices()
            .find((v) => v.lang.toLowerCase().startsWith('vi'));
          if (!voice)
            throw new Error('Thiết bị chưa có giọng Việt; lời chúc vẫn hiển thị trên màn hình.');
          await Promise.race([
            interrupted,
            new Promise<void>((resolve, reject) => {
              const speech = new SpeechSynthesisUtterance(job.text);
              speech.lang = 'vi-VN';
              speech.voice = voice;
              speech.rate = 0.9;
              speech.onend = () => resolve();
              speech.onerror = () => reject(new Error('Giọng thiết bị không khả dụng.'));
              speechSynthesis.speak(speech);
            }),
          ]);
        } else
          await Promise.race([interrupted, new Promise((resolve) => setTimeout(resolve, 5000))]);
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        mixer.current.setSpeaking(false);
        if (watchdog) clearInterval(watchdog);
        if (timeout) clearTimeout(timeout);
        cancelPlayback = null;
        audio.pause();
        window.speechSynthesis?.cancel();
        if (job)
          await api('/broadcast/complete', { id: job.id }, { 'X-Broadcast-Token': token }).catch(
            () => {},
          );
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        playing.current = false;
      }
    }
    const id = setInterval(() => void next(), 2000);
    void next();
    return () => {
      mounted = false;
      clearInterval(id);
      audio.pause();
      window.speechSynthesis?.cancel();
      cancelPlayback?.();
    };
  }, [enabled, token, deviceVoice]);
  return (
    <div className="broadcast-page">
      <div className="broadcast-canvas">
        <div className="broadcast-title">
          <Lotus size={36} />
          <h1>{room?.config.title ?? 'Tu Hành Online'}</h1>
          <p>{room?.config.roomName ?? 'Chánh điện'}</p>
        </div>
        <div className="scene broadcast-scene">
          <TempleArt />
          <Experience room={room} />
          <Seats room={room} outfits={outfits} />
        </div>
        <div className="broadcast-caption">
          <Lotus size={28} />
          <p>{caption || 'Một hơi thở nhẹ, một niệm an lành.'}</p>
          {gift && (
            <small>
              {gift.provider === 'mock' ? 'MÔ PHỎNG · ' : ''}Cảm ơn {gift.name} · {gift.quantity}{' '}
              quà
            </small>
          )}
          <small>Giọng AI khi dùng dịch vụ TTS · Chế độ mặc định: lời chúc bằng chữ</small>
        </div>
        <div className="broadcast-count">
          {room?.occupied ?? 0}/{room?.capacity ?? 36} chỗ · {room?.waiting ?? 0} đang chờ · Tham
          gia miễn phí · Quà không ưu tiên chỗ
        </div>
      </div>
      <aside className="broadcast-controls">
        <h2>Điều khiển phát sóng</h2>
        <p>
          Màn hình dọc 9:16. Đặt vùng nội dung trong OBS; không đưa bảng điều khiển này lên LIVE.
        </p>
        {!token ? (
          <p className="form-error">Tạo liên kết có thời hạn tại trang Admin trước khi phát.</p>
        ) : (
          <button className="primary-button" onClick={() => setEnabled(!enabled)}>
            {enabled ? 'Tạm dừng nhận lời chúc' : 'Bật nhận lời chúc / cho phép âm thanh'}
          </button>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={deviceVoice}
            onChange={(e) => setDeviceVoice(e.target.checked)}
            disabled={enabled}
          />
          Dùng giọng thiết bị cho mock (không phải dịch vụ AI)
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Nhạc bạn có quyền sử dụng (chỉ máy phát)
          <input
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 25_000_000) {
                setError('Tệp nhạc tối đa 25 MB.');
                return;
              }
              background.current.pause();
              if (musicUrl.current) URL.revokeObjectURL(musicUrl.current);
              musicUrl.current = URL.createObjectURL(file);
              background.current.src = musicUrl.current;
              background.current.loop = true;
              void background.current
                .play()
                .catch(() => setError('Trình duyệt chưa cho phép phát nhạc.'));
            }}
          />
        </label>
        <label>
          Âm lượng nhạc
          <input
            aria-label="Âm lượng nhạc"
            type="range"
            min="0"
            max="1"
            step=".05"
            defaultValue=".5"
            onChange={(e) => mixer.current.setVolume(Number(e.target.value))}
          />
        </label>
        <button onClick={() => background.current.pause()}>Dừng nhạc</button>
        <a href="/admin">Trở về Admin</a>
      </aside>
    </div>
  );
}
