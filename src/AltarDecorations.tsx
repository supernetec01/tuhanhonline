import { useEffect, useRef, useState } from 'react';
import { type Settings } from '../server/config';
export function AltarDecorations({
  config,
  portraitMode,
}: {
  config: Settings['decorations'];
  portraitMode?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [portrait, setPortrait] = useState(portraitMode ?? matchMedia('(max-width:650px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width:650px)');
    const update = () => setPortrait(portraitMode ?? query.matches);
    update();
    query.addEventListener('change', update);
    const parent = svg.current?.parentElement;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ width: r.width, height: r.height });
    });
    if (parent) observer.observe(parent);
    return () => {
      observer.disconnect();
      query.removeEventListener('change', update);
    };
  }, [portraitMode]);
  const scale = Math.min(box.width / 1000, box.height / 1600);
  const fit =
    portrait && scale
      ? {
          width: 1400 * 1.15 * scale,
          height: 1000 * 1.15 * scale,
          left: (box.width - 1000 * scale) / 2 - 305 * scale,
          top: (box.height - 1600 * scale) / 2,
        }
      : undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      ref={svg}
      style={fit}
      className="altar-decorations"
      viewBox="0 0 1400 1000"
      aria-hidden="true"
    >
      <g
        transform={`translate(${config.offsetX * 14} ${config.offsetY * 10}) translate(700 410) scale(${config.scale}) translate(-700 -410)`}
      >
        {config.fruit &&
          [600, 800].map((x) => (
            <g key={x} transform={`translate(${x} 400) scale(.6)`}>
              <ellipse cy="9" rx="48" ry="10" fill="#37201c" stroke="#b28c4f" strokeWidth="2" />
              <path
                d="M-28 0Q-45 -30 -16 -18L0 -6L20 -24Q40 -29 32 -2Z"
                fill="#7b8747"
                stroke="#d3b665"
              />
              <circle cx="-12" cy="-8" r="13" fill="#b48342" />
              <circle cx="12" cy="-7" r="12" fill="#ac5340" />
              <circle cy="-23" r="13" fill="#879154" />
              <path d="M0 -34L4 -41" stroke="#b99b5e" strokeWidth="3" />
            </g>
          ))}
        {config.cakes &&
          [650, 750].map((x) => (
            <g key={x} transform={`translate(${x} 404)`}>
              <ellipse cy="5" rx="29" ry="6" fill="#ae8b57" />
              <rect x="-20" y="-8" width="40" height="11" rx="3" fill="#ceb48b" />
              <path d="M-13 -7L-10 -14H10L13 -7" fill="#dcc59f" />
              <path d="M-15 -2H15" stroke="#a68052" />
            </g>
          ))}
        {config.lotus &&
          [515, 885].map((x) => (
            <g key={x} transform={`translate(${x} 400)`}>
              <path d="M-13 -25Q-23 7 -10 17H10Q23 7 13 -25Z" fill="#61736a" stroke="#bd9c66" />
              <path d="M0 -24V-66M-4 -21L-16 -56M5 -21L17 -61" stroke="#81906b" strokeWidth="2" />
              {[
                [-16, -55],
                [0, -68],
                [17, -60],
              ].map(([cx, cy], i) => (
                <g key={i} transform={`translate(${cx} ${cy})`}>
                  <path d="M0 5Q-20 -8 -13 -19Q-3 -21 0 -3Q3 -21 13 -19Q20 -8 0 5" fill="#b87d86" />
                  <path d="M0 3Q-8 -14 0 -25Q8 -14 0 3" fill="#d2a6aa" />
                </g>
              ))}
            </g>
          ))}
        {config.censer &&
          [602, 798].map((x, i) => (
            <g key={x} transform={`translate(${x} 405)`}>
              <path
                d="M-28 -9Q-26 16 -16 18H16Q26 16 28 -9Z"
                fill="#a77f45"
                stroke="#dfc28b"
                strokeWidth="2"
              />
              <ellipse cy="-9" rx="28" ry="6" fill="#49372a" stroke="#b89458" />
              <path
                d="M-18 16L-22 25M18 16L22 25M-7 -10V-43M0 -10V-48M7 -10V-42"
                stroke="#b08a55"
                strokeWidth="3"
              />
              <g className="altar-smoke" fill="none" stroke="#e5d1ab" opacity=".25" strokeWidth="2">
                <path d="M0 -49Q-15 -67 0 -81Q15 -100 0 -118" />
                <path d="M7 -43Q20 -63 9 -80" />
              </g>
              <text textAnchor="middle" y="40" fontSize="10" fill="#d7bd86">
                Trạm {i === 0 ? 'A' : 'B'}
              </text>
            </g>
          ))}
        {config.donationBox && (
          <g transform="translate(1065 453)">
            <path
              d="M-30 -26L0 -35L31 -25V21L0 34L-30 22Z"
              fill="#68372d"
              stroke="#a7834d"
              strokeWidth="2"
            />
            <path d="M-30 -26L0 -17L31 -25M0 -17V34" fill="none" stroke="#bf9a61" />
            <path d="M-10 -27L7 -29" stroke="#261719" strokeWidth="4" />
            <text x="-24" y="3" fontSize="8" fill="#dbbe86">
              CÔNG
            </text>
            <text x="-23" y="14" fontSize="8" fill="#dbbe86">
              ĐỨC
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}
