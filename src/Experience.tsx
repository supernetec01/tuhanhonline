import { useEffect, useState } from 'react';
import { type RoomSnapshot } from './useTemple';
import { Lotus } from './Art';
export function useSceneTime() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}
export function ceremonyPhase(run: any, now: number) {
  if (!run) return null;
  const elapsed = (now - new Date(run.starts_at).getTime()) / 1000;
  if (elapsed < 0 || elapsed >= 60) return null;
  return elapsed < 10
    ? 'prepare'
    : elapsed < 25
      ? 'bow'
      : elapsed < 40
        ? 'blessing'
        : elapsed < 55
          ? 'prostrate'
          : 'finish';
}
export function Experience({ room }: { room: RoomSnapshot | null }) {
  const time = useSceneTime() + (room?.clockOffsetMs ?? 0),
    phase = ceremonyPhase(room?.ceremony, time),
    effect = room?.effect;
  const active = effect && new Date(effect.ends_at).getTime() > time;
  return (
    <>
      {phase && (
        <div className={`ceremony-overlay ceremony-${phase}`} role="status">
          <Lotus size={22} />
          <span>
            {phase === 'prepare'
              ? 'Thời khắc bình an sắp bắt đầu'
              : phase === 'bow'
                ? 'Cùng chắp tay, trở về hiện tại'
                : phase === 'blessing'
                  ? 'Nguyện chúc mọi người luôn bình an, khỏe mạnh và an nhiên.'
                  : phase === 'prostrate'
                    ? 'Cùng cúi lạy trong một niệm lành'
                    : 'Tiếp tục một ngày an yên'}
          </span>
        </div>
      )}
      {active && (
        <div
          className={`visual-effect effect-${effect.kind}`}
          data-effect={effect.kind}
          role="status"
        >
          <div className="effect-art">
            {effect.kind === 'lotus' ? (
              <Lotus size={90} />
            ) : effect.kind === 'lantern' ? (
              <>
                <span className="effect-lantern" />
                <span className="effect-lantern" />
              </>
            ) : (
              <>
                <i />
                <i />
                <i />
              </>
            )}
          </div>
          {effect.show_name && <span className="effect-thanks">Cảm ơn {effect.name}</span>}
        </div>
      )}
    </>
  );
}
