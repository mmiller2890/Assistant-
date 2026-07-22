interface AileronMarkProps {
  size?: number;
  className?: string;
}

/**
 * Stepped-ziggurat "A" — the mark for the Emerald & Brass reskin. A tall
 * chevron in brass with an emerald inner face and a stepped (setback) base,
 * evoking a Deco skyscraper crown. Pure SVG, colors from theme tokens.
 */
export function AileronMark({ size = 40, className }: AileronMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Aileron"
    >
      <path d="M60 12 L98 100 L79 100 L60 56 L41 100 L22 100 Z" fill="var(--primary)" />
      <path d="M60 40 L81 96 L69 96 L60 72 L51 96 L39 96 Z" fill="var(--emerald)" />
      <rect x="28" y="102" width="64" height="4" fill="var(--primary)" />
      <rect x="37" y="110" width="46" height="3" fill="var(--brass-dim)" />
    </svg>
  );
}
