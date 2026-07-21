import { cn } from "@/lib/utils";

interface ChevronRuleProps {
  className?: string;
}

/**
 * A brass hairline broken by a centered chevron — the reskin's divider motif
 * (used under headings and around sidebar sections). Replaces the usual
 * center-diamond with a Deco chevron/zigzag reference.
 */
export function ChevronRule({ className }: ChevronRuleProps) {
  return (
    <div
      className={cn("flex items-center justify-center gap-2 w-full", className)}
      aria-hidden="true"
    >
      <span
        className="h-px flex-1"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--primary), transparent)",
        }}
      />
      <svg width="16" height="9" viewBox="0 0 16 9" fill="none">
        <path
          d="M1 8 L8 1.5 L15 8"
          stroke="var(--primary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="h-px flex-1"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--primary), transparent)",
        }}
      />
    </div>
  );
}
