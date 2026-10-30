import { useSceneTime, ceremonyPhase } from './Experience';
import { Avatar } from './Art';
import { type Outfit } from './api';
import { type RoomSnapshot } from './useTemple';
export function Seats({
  room,
  outfits,
  userId,
}: {
  room: RoomSnapshot | null;
  outfits: Outfit[];
  userId?: string;
}) {
  const now = useSceneTime() + (room?.clockOffsetMs ?? 0);
  const phase = ceremonyPhase(room?.ceremony, now);
  return (
    <div className="seating" aria-label="Sơ đồ 36 chỗ ngồi đồng bộ máy chủ">
      {room?.seats.map((seat: any) => {
        const player = seat.player,
          isMe = !!player && !!userId && player.player_id === userId,
          robe = outfits.find((o) => o.id === player?.equipped);
        const serverNow = now;
        const active = player?.action && new Date(player.ends_at).getTime() > serverNow;
        return (
          <div
            key={seat.id}
            className={`seat ${isMe ? 'your-seat' : ''} ${!seat.enabled ? 'seat-disabled' : ''}`}
            title={player ? `${seat.code} · ${player.name}` : seat.code}
            data-seat={seat.code}
            style={
              {
                left: `${seat.x}%`,
                top: `${seat.y}%`,
                width: `${seat.scale}%`,
                zIndex: active && player.action === 'incense' ? 98 : Math.floor(seat.y),
                '--walk-x': `${((50 - seat.x) / (seat.scale * 1.16)) * 100}%`,
                '--walk-y': `${(((42 - seat.y) * 0.76) / ((seat.scale * 1.16 * 140) / 120)) * 100}%`,
              } as React.CSSProperties
            }
          >
            <div className="cushion" />
            {player && (
              <Avatar
                key={`${player.player_id}:${active ? player.started_at : phase}`}
                color={robe?.color}
                accent={robe?.accent}
                outfitId={player.equipped}
                accessory={player.accessory}
                action={
                  active
                    ? player.action
                    : phase === 'bow'
                      ? 'bow'
                      : phase === 'prostrate'
                        ? 'prostrate'
                        : 'idle'
                }
                durationMs={
                  active
                    ? new Date(player.ends_at).getTime() - new Date(player.started_at).getTime()
                    : undefined
                }
                elapsedMs={
                  active
                    ? Math.max(0, serverNow - new Date(player.started_at).getTime())
                    : undefined
                }
              />
            )}
            {(isMe || (player && room.config.live.showNames)) && (
              <span className="you-label">
                {player.name} · {seat.code}
              </span>
            )}
            {seat.reserved && <span className="reserved-dot" />}
          </div>
        );
      })}
    </div>
  );
}
