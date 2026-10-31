import { RigSvg, type AppearanceType, type Facing, type RigAction } from './CharacterRig';

export function Lotus({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6C13 17 14 28 24 35C34 28 35 17 24 6Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7 16C6 30 12 37 24 37C24 25 18 18 7 16ZM41 16C42 30 36 37 24 37C24 25 30 18 41 16Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M3 29C7 40 16 44 24 38C32 44 41 40 45 29"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Avatar({
  color = '#a9b5a0',
  accent = '#d6dac4',
  front = false,
  action = 'idle',
  className = '',
  outfitId = 'linen',
  accessory = 'none',
  dots = 0,
  dotLayout,
  design,
  hideShadow = false,
  appearanceType = 'male',
  direction,
  durationMs,
  elapsedMs = 0,
}: {
  color?: string;
  accent?: string;
  front?: boolean;
  action?: string;
  className?: string;
  outfitId?: string;
  accessory?: string;
  dots?: number;
  design?: string;
  hideShadow?: boolean;
  appearanceType?: AppearanceType;
  direction?: Facing;
  dotLayout?: { x: number; y: number; size: number; spacing: number };
  durationMs?: number;
  elapsedMs?: number;
}) {
  const rigAction: RigAction =
    action === 'idle'
      ? 'seated'
      : [
            'bow',
            'prostrate',
            'standing',
            'walk',
            'incense',
            'holdIncense',
            'sitDown',
            'standUp',
          ].includes(action)
        ? (action as RigAction)
        : 'seated';
  return (
    <RigSvg
      color={color}
      accent={accent}
      appearance={appearanceType}
      facing={direction ?? (front ? 'front' : 'back')}
      action={rigAction}
      phase={durationMs ? Math.min(1, elapsedMs / durationMs) : 0}
      design={design ?? outfitId}
      outfitId={outfitId}
      accessory={accessory}
      dots={dots}
      dotLayout={dotLayout}
      className={`${className} ${hideShadow ? 'rig-no-shadow' : ''}`}
    />
  );
}

export function TempleArt() {
  return (
    <svg
      className="temple-art"
      viewBox="0 0 1400 1000"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Chánh điện trầm ấm với tượng Phật vàng trang nghiêm"
    >
      <image href="/sanctuary.svg" width="1400" height="1000" />
    </svg>
  );
}
