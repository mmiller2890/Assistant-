interface AileronMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Aileron mark for the Emerald & Brass reskin: a bold, flat-crowned Art
 * Deco "A" — brass legs and crossbar with a real emerald counter (the enclosed
 * triangle) and a stepped brass plinth. The flat crown + setback base read as a
 * Deco skyscraper. Pure SVG, colors from theme tokens.
 */
export function AileronMark({ size = 40, className }: AileronMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Aileron"
    >
      {/* emerald counter inlay (the enclosed triangle of the A) */}
      <path d="M50 20 L60 55 L40 55 Z" fill="var(--emerald)" />
      {/* brass legs meeting at a flat Deco crown */}
      <path
        d="M17 88 L46 10 L54 10 L83 88"
        stroke="var(--primary)"
        strokeWidth="10"
        strokeLinejoin="miter"
      />
      {/* brass crossbar */}
      <path d="M33 57 L67 57" stroke="var(--primary)" strokeWidth="7" />
      {/* stepped plinth */}
      <rect x="15" y="90" width="70" height="4.5" fill="var(--primary)" />
      <rect x="26" y="97.5" width="48" height="2.5" fill="var(--brass-dim)" />
    </svg>
  );
}
