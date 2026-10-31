export type AppearanceType = 'male' | 'female';
export type Facing = 'front' | 'back' | 'left' | 'right';
export type RigAction =
  | 'seated'
  | 'standing'
  | 'walk'
  | 'sitDown'
  | 'standUp'
  | 'bow'
  | 'prostrate'
  | 'holdIncense'
  | 'incense';
export type BodyPart = 'head' | 'torso' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight';
export type Transform = { x: number; y: number; angle: number; sx: number; sy: number };
export const partBoxes: Record<BodyPart, { x: number; y: number; w: number; h: number }> = {
  head: { x: -30, y: -32, w: 60, h: 64 },
  torso: { x: -29, y: -6, w: 58, h: 58 },
  armLeft: { x: -10, y: -5, w: 20, h: 45 },
  armRight: { x: -10, y: -5, w: 20, h: 45 },
  legLeft: { x: -9, y: -4, w: 18, h: 38 },
  legRight: { x: -9, y: -4, w: 18, h: 38 },
};
export function rigPose(action: RigAction, phase = 0): Record<BodyPart, Transform> {
  const t = (x: number, y: number, angle = 0, sx = 1, sy = 1) => ({ x, y, angle, sx, sy });
  const standing = {
    head: t(60, 38),
    torso: t(60, 66),
    armLeft: t(35, 72),
    armRight: t(85, 72),
    legLeft: t(48, 107),
    legRight: t(72, 107),
  };
  const seated = {
    head: t(60, 62),
    torso: t(60, 90, 0, 1, 0.69),
    armLeft: t(37, 94, -24, 1, 0.8),
    armRight: t(83, 94, 24, 1, 0.8),
    legLeft: t(48, 118, 68, 1, 0.7),
    legRight: t(72, 118, -68, 1, 0.7),
  };
  let p =
    action === 'standing' || action === 'walk' || action === 'holdIncense' || action === 'incense'
      ? standing
      : seated;
  if (action === 'sitDown' || action === 'standUp') {
    const f = Math.max(0, Math.min(1, action === 'standUp' ? 1 - phase : phase));
    p = Object.fromEntries(
      (Object.keys(standing) as BodyPart[]).map((k) => [
        k,
        Object.fromEntries(
          Object.keys(standing[k]).map((key) => {
            const v = key as keyof Transform;
            return [v, standing[k][v] + (seated[k][v] - standing[k][v]) * f];
          }),
        ),
      ]),
    ) as Record<BodyPart, Transform>;
  }
  if (action === 'walk') {
    const wave = Math.sin(phase * Math.PI * 2);
    p.armLeft.angle = -wave * 24;
    p.armRight.angle = wave * 24;
    p.legLeft.angle = wave * 22;
    p.legRight.angle = -wave * 22;
    p.head.y -= Math.abs(wave) * 1.5;
    p.torso.y -= Math.abs(wave) * 1.5;
  }
  if (action === 'bow') {
    const f = Math.sin(Math.max(0, Math.min(1, phase)) * Math.PI);
    p.head.y += f * 13;
    p.head.sy = 1 - f * 0.18;
    p.torso.sy -= f * 0.12;
    p.armLeft.angle = -42;
    p.armRight.angle = 42;
  }
  if (action === 'prostrate') {
    const f = Math.sin(Math.max(0, Math.min(1, phase)) * Math.PI);
    p.head.y += f * 43;
    p.head.sy = 1 - f * 0.55;
    p.torso.y += f * 22;
    p.torso.sy -= f * 0.35;
    p.armLeft = t(38, 108 + f * 12, -55, 1, 0.8);
    p.armRight = t(82, 108 + f * 12, 55, 1, 0.8);
  }
  if (action === 'holdIncense' || action === 'incense') {
    p.armLeft.angle = -38;
    p.armRight.angle = 38;
  }
  return p;
}
export function PartDrawing({
  part,
  color = '#a9b5a0',
  accent = '#d6dac4',
  appearance = 'male',
  facing = 'back',
  design = 'novice',
}: {
  part: BodyPart;
  color?: string;
  accent?: string;
  appearance?: AppearanceType;
  facing?: Facing;
  design?: string;
}) {
  const side = facing === 'left' || facing === 'right';
  if (part === 'head')
    return (
      <g transform={facing === 'right' ? 'scale(-1 1)' : undefined}>
        {appearance === 'female' && (
          <path d="M-22 -13Q0 -36 22 -13L24 19Q0 34 -24 19Z" fill="#3f302e" />
        )}
        <ellipse rx={side ? 20 : 24} ry="25" fill="#eac5a0" stroke="#a97859" strokeWidth=".9" />
        <path
          d="M-16 -16Q-8 -23 0 -22"
          fill="none"
          stroke="#fff0d8"
          strokeWidth="3"
          opacity=".6"
          strokeLinecap="round"
        />
        {facing !== 'back' && (
          <>
            <path
              d={side ? 'M-17 -1q4 3 7 0' : 'M-15 -1q5 4 10 0M5 -1q5 4 10 0'}
              fill="none"
              stroke="#65504a"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path
              d={side ? 'M-19 9q3 3 6 0' : 'M-4 11q4 3 8 0'}
              fill="none"
              stroke="#996b58"
              strokeWidth="1.2"
            />
            <ellipse cx={side ? -16 : -15} cy="7" rx="4" ry="2" fill="#cd8e83" opacity=".35" />
            {!side && <ellipse cx="15" cy="7" rx="4" ry="2" fill="#cd8e83" opacity=".35" />}
          </>
        )}
        {side && <path d="M-18 -7L-25 3L-18 6" fill="#eac5a0" stroke="#a97859" strokeWidth=".7" />}
        {appearance === 'female' && (
          <>
            <path
              d="M-23 -8Q-26 -30 0 -27Q25 -29 24 -6L16 -14Q3 -7 -3 -18Q-12 -10 -23 -8"
              fill="#493734"
            />
            <circle cx="9" cy="-24" r="7" fill="#493734" />
            <path d="M4 -28L15 -26" stroke="#b2a18a" strokeWidth="2" />
          </>
        )}
      </g>
    );
  if (part === 'torso')
    return (
      <g>
        <rect x="-5" y="-6" width="10" height="12" rx="3" fill="#eac5a0" />
        <path
          d={
            side
              ? 'M-14 1Q-24 15 -20 41L-15 47H17L21 39Q22 12 13 1Z'
              : 'M-18 1Q-30 16 -26 41Q0 52 26 41Q30 15 18 1Z'
          }
          fill={color}
          stroke="#746b5b"
          strokeWidth=".8"
        />
        <path
          d={facing === 'back' ? 'M12 2L-15 43H17L23 14Z' : 'M-13 2L12 45H-15L-23 15Z'}
          fill={accent}
        />
        <path
          d="M-18 14L-19 35M18 15L20 36M-9 42H9"
          fill="none"
          stroke="#4c493e"
          opacity=".23"
          strokeWidth="1.2"
        />
        {['lotus', 'ceremony', 'jade'].includes(design) && (
          <path d="M0 37Q-12 26 -8 20Q0 20 0 30Q0 20 8 20Q12 26 0 37Z" fill={accent} opacity=".8" />
        )}
        {design === 'belt' && <path d="M-25 29Q0 36 25 29L24 34Q0 41 -24 34Z" fill={accent} />}
      </g>
    );
  if (part.startsWith('arm'))
    return (
      <g>
        <path d="M-7 0Q0 -4 7 0L8 27L-8 27Z" fill={color} stroke="#746b5b" strokeWidth=".7" />
        <path d="M-8 23H8" stroke={accent} strokeWidth="3" />
        <path d="M-5 28Q-6 38 0 38Q6 38 5 28Z" fill="#eac5a0" stroke="#a97859" strokeWidth=".6" />
      </g>
    );
  return (
    <g>
      <path d="M-7 0H7L6 24H-6Z" fill={color} stroke="#746b5b" strokeWidth=".7" />
      <path
        d="M-6 24Q0 22 6 24L8 29Q0 35 -8 29Z"
        fill="#c2b49c"
        stroke="#82745f"
        strokeWidth=".9"
      />
    </g>
  );
}
export function RigSvg({
  color,
  accent,
  appearance = 'male',
  facing = 'back',
  action = 'seated',
  phase = 0,
  design,
  outfitId = 'linen',
  accessory = 'none',
  dots = 0,
  className = '',
  dotLayout,
}: {
  color?: string;
  accent?: string;
  appearance?: AppearanceType;
  facing?: Facing;
  action?: RigAction;
  phase?: number;
  design?: string;
  outfitId?: string;
  accessory?: string;
  dots?: number;
  className?: string;
  dotLayout?: { x: number; y: number; size: number; spacing: number };
}) {
  const pose = rigPose(action, phase),
    parts: BodyPart[] = ['legLeft', 'legRight', 'torso', 'armLeft', 'armRight', 'head'];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`avatar ${className}`}
      viewBox="0 0 120 140"
      data-outfit={outfitId}
      data-appearance={appearance}
      data-direction={facing}
      data-action={action}
      aria-hidden="true"
    >
      <g data-layer="shadow">
        <ellipse cx="60" cy="135" rx="30" ry="4" fill="#332821" opacity=".17" />
      </g>
      {parts.map((part) => {
        const p = pose[part];
        return (
          <g
            data-layer={part === 'torso' ? 'robe' : part}
            key={part}
            transform={`translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${p.sx} ${p.sy})`}
          >
            <PartDrawing
              part={part}
              color={color}
              accent={accent}
              appearance={appearance}
              facing={facing}
              design={design}
            />
          </g>
        );
      })}
      <g data-layer="accessory">
        {accessory === 'beads' &&
          Array.from({ length: 11 }, (_, i) => (
            <circle
              key={i}
              cx={60 + 16 * Math.cos((i * Math.PI) / 10)}
              cy={pose.torso.y + 10 + 15 * Math.sin((i * Math.PI) / 10)}
              r="2.4"
              fill="#856044"
              stroke="#d8b880"
              strokeWidth=".5"
            />
          ))}
        {accessory === 'lotus' && (
          <path d="M83 114Q71 99 79 96Q84 97 83 105Q84 96 91 98Q98 106 83 114Z" fill="#d8a0ab" />
        )}
      </g>
      <g data-layer="dots">
        {Array.from({ length: Math.min(8, dots) }, (_, i) => (
          <circle
            key={i}
            cx={(dotLayout?.x ?? 60) + ((i % 4) - 1.5) * (dotLayout?.spacing ?? 5)}
            cy={
              pose.head.y -
              18 +
              ((dotLayout?.y ?? 26) - 26) +
              Math.floor(i / 4) * (dotLayout?.spacing ?? 5)
            }
            r={dotLayout ? (dotLayout.size * 17) / 48 : 1.8}
            fill="#dfc78d"
          />
        ))}
      </g>
      <g data-layer="hands">
        {facing === 'front' && action === 'seated' && (
          <path
            d={`M51 ${pose.torso.y + 24}L60 ${pose.torso.y + 17}L69 ${pose.torso.y + 24}`}
            stroke="#eac5a0"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </g>
    </svg>
  );
}
