import { Button, AileronMark, ChevronRule } from "@/components";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMenuItems, useVersion } from "@/hooks";

export const Sidebar = () => {
  const { version, isLoading } = useVersion();
  const { menu, footerLinks, footerItems } = useMenuItems();

  const navigate = useNavigate();
  const activeRoute = useLocation().pathname;
  return (
    <aside className="relative flex w-56 flex-col select-none pt-2 bg-sidebar border-r border-sidebar-border">
      {/* emerald reeded spine on the inner edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-[3px] opacity-60"
        style={{
          background:
            "repeating-linear-gradient(180deg, var(--emerald) 0 6px, transparent 6px 11px)",
        }}
      />

      {/* Logo */}
      <div
        onClick={() => navigate("/dashboard")}
        className="flex cursor-pointer flex-col items-center gap-2.5 px-4 pb-2 pt-9"
      >
        <AileronMark size={40} />
        <div className="flex flex-col items-center">
          <h1
            className="text-sm uppercase tracking-[0.32em] text-foreground lg:text-base"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              textIndent: "0.32em",
            }}
          >
            Aileron
          </h1>
          <span className="mt-0.5 block font-mono text-[9px] tracking-[0.18em] text-meta">
            {isLoading ? "loading" : `v${version}`}
          </span>
        </div>
      </div>

      <ChevronRule className="px-6 py-2" />

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-5">
        {menu.map((item, index) => (
          <button
            onClick={() => navigate(item.href)}
            key={`${item.label}-${index}`}
            className={cn(
              "flex w-full items-center justify-between gap-3 border-l-2 border-transparent px-3 py-2 text-[12px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground",
              activeRoute.includes(item.href)
                ? "border-primary bg-sidebar-accent text-primary hover:text-primary"
                : ""
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className="size-3.5 transition-all duration-300" />
              {item.label}
            </div>
            {item.count ? (
              <span className="flex size-5 items-center justify-center border border-border font-mono text-[10px] text-muted-foreground">
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="flex flex-col space-y-1 px-3 pb-3">
        <ChevronRule className="mb-3" />
        <div className="mb-3 flex flex-row items-center justify-evenly gap-2">
          {footerLinks.map((item, index) => (
            <Button
              key={`${item.title}-${index}`}
              title={item.title}
              size="sm"
              variant="outline"
              onClick={() => openUrl(item.link)}
            >
              <item.icon className="size-3.5 transition-all duration-300" />
            </Button>
          ))}
        </div>

        {footerItems.map((item, index) => (
          <a
            href={item.href}
            onClick={item.action}
            target="_blank"
            rel="noopener noreferrer"
            key={`${item.label}-${index}`}
            className="flex w-full items-center gap-3 px-3 py-2 text-[12px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <item.icon className="size-3.5 transition-all duration-300" />
            {item.label}
          </a>
        ))}
      </div>
    </aside>
  );
};
