/**
 * The house, drawn once, beside the town's hero on the Maison screen. It is
 * decoration: the residence level and the workshops it holds climb with the
 * house, so the drawing says what the figures say, never more.
 */
export function HouseScene({ residenceLevel }: { residenceLevel: number }) {
  // A tower grows with the residence; the courtyard fills after the threshold.
  const towerHeight = 34 + Math.min(Math.max(residenceLevel, 1), 12) * 4;
  const wings = residenceLevel >= 6 ? 2 : residenceLevel >= 3 ? 1 : 0;

  return (
    <svg viewBox="0 0 390 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="house-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c9b98f" />
          <stop offset="1" stop-color="#efe3c6" />
        </linearGradient>
        <linearGradient id="house-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f4e8cd" />
          <stop offset="1" stop-color="#d8c39a" />
        </linearGradient>
      </defs>
      <rect width="390" height="150" fill="url(#house-sky)" />
      <circle cx="318" cy="34" r="22" fill="#fff6dc" opacity=".55" />
      {/* The courtyard: a walled ground the house stands on. */}
      <rect y="118" width="390" height="32" fill="#b9a887" />
      <rect y="118" width="390" height="3" fill="#9c8a6b" />
      {/* The main body: a stone house with a pitched, tiled roof. */}
      <rect x="132" y="66" width="126" height="56" fill="url(#house-wall)" />
      <path d="M124 68 195 34l71 34z" fill="#a24a34" />
      <path d="M124 68 195 34l71 34z" fill="none" stroke="#7d3726" stroke-width="2" />
      <rect x="150" y="84" width="16" height="20" fill="#6f5f45" />
      <rect x="224" y="84" width="16" height="20" fill="#6f5f45" />
      <rect x="180" y="86" width="30" height="36" fill="#7a5a3c" />
      <circle cx="206" cy="104" r="1.8" fill="#e7d3a8" />
      {wings >= 1 ? (
        <>
          <rect x="70" y="88" width="62" height="34" fill="url(#house-wall)" />
          <path d="M64 90l37-20 37 20z" fill="#8e5a3f" />
          <rect x="92" y="98" width="14" height="14" fill="#6f5f45" />
        </>
      ) : null}
      {wings >= 2 ? (
        <>
          <rect x="258" y="88" width="62" height="34" fill="url(#house-wall)" />
          <path d="M252 90l37-20 37 20z" fill="#8e5a3f" />
          <rect x="282" y="98" width="14" height="14" fill="#6f5f45" />
        </>
      ) : null}
      {/* The tower: one spring per residence level, so the ladder is legible. */}
      <rect x="188" y={122 - towerHeight} width="14" height={towerHeight} fill="#e6d4ae" />
      <rect
        x="188"
        y={122 - towerHeight}
        width="14"
        height={towerHeight}
        fill="none"
        stroke="#b49c76"
        stroke-width="1"
      />
      <path d={`M184 ${122 - towerHeight}h22L195 ${122 - towerHeight - 26}z`} fill="#5f7285" />
      <g fill="#3f4a55">
        {Array.from({ length: Math.min(residenceLevel, 8) }, (_, index) => (
          <rect key={index} x="191" y={122 - towerHeight + 6 + index * 4} width="8" height="2" opacity=".55" />
        ))}
      </g>
    </svg>
  );
}
