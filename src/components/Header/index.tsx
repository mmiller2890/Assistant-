import { Button, Label, ChevronRule } from "@/components";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface HeaderProps {
  title: string;
  description: string;
  isMainTitle?: boolean;
  titleClassName?: string;
  descriptionClassName?: string;
  rightSlot?: React.ReactNode | null;
  showBorder?: boolean;
  className?: string;
  allowBackButton?: boolean;
}

export const Header = ({
  title,
  description,
  isMainTitle = false,
  titleClassName,
  descriptionClassName,
  rightSlot = null,
  showBorder = false,
  className,
  allowBackButton = false,
}: HeaderProps) => {
  const navigate = useNavigate();
  const showRule = isMainTitle && (showBorder || !rightSlot);
  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn(
          "flex",
          rightSlot ? "flex-row items-center justify-between" : "flex-col"
        )}
      >
        <div className="flex items-center gap-2">
          {allowBackButton && (
            <Button size="icon" variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeftIcon className="size-3 lg:size-4 transition-all duration-300" />
            </Button>
          )}
          <div className="flex flex-col gap-1">
            {isMainTitle ? (
              <Label
                className={cn(
                  "line-clamp-1 uppercase tracking-[0.24em] text-primary text-base lg:text-xl",
                  titleClassName
                )}
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              >
                {title}
              </Label>
            ) : (
              <Label
                className={cn(
                  "line-clamp-1 uppercase tracking-[0.16em] text-foreground text-xs lg:text-sm transition-all duration-300",
                  titleClassName
                )}
                style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
              >
                {title}
              </Label>
            )}
            <p
              className={cn(
                `select-none text-muted-foreground leading-relaxed ${
                  isMainTitle
                    ? "text-xs lg:text-sm"
                    : "text-[10px] lg:text-xs transition-all duration-300"
                } ${descriptionClassName}`
              )}
            >
              {description}
            </p>
          </div>
        </div>
        {rightSlot}
      </div>
      {showRule && <ChevronRule className="mt-3" />}
    </div>
  );
};
