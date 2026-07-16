import { SparklesIcon } from "lucide-react";
import { Button } from "@/components";
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
    <aside className="flex w-56 flex-col select-none pt-2 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div
        onClick={() => navigate("/dashboard")}
        className="flex h-16 items-center px-4 pt-10 gap-1.5"
      >
        <div className="flex size-6 lg:size-7 items-center justify-center rounded-md border border-primary">
          <SparklesIcon className="size-4 lg:size-5 text-primary transition-all duration-300" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-xs lg:text-md font-medium text-foreground transition-all duration-300">
            Assistant
          </h1>
          <span className="font-mono text-[8px] lg:text-[10px] text-meta -mt-1 block">
            {isLoading ? "loading" : `v${version}`}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-6">
        {menu.map((item, index) => (
          <button
            onClick={() => navigate(item.href)}
            key={`${item.label}-${index}`}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 font-mono text-xs lowercase text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
              activeRoute.includes(item.href)
                ? "bg-sidebar-accent text-primary hover:text-primary"
                : ""
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className="size-3 lg:size-4 transition-all duration-300" />
              {item.label}
            </div>
            {item.count ? (
              <span className="flex size-5 items-center justify-center rounded-md bg-secondary border border-border font-mono text-[10px] text-muted-foreground">
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="flex flex-col space-y-1 px-3  pb-3">
        <div className="flex flex-row justify-evenly items-center gap-2 mb-3">
          {footerLinks.map((item, index) => (
            <Button
              key={`${item.title}-${index}`}
              title={item.title}
              size="sm"
              variant="outline"
              onClick={() => openUrl(item.link)}
            >
              <item.icon className="size-3 lg:size-4 transition-all duration-300" />
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
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 font-mono text-xs lowercase text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className="size-3 lg:size-4 transition-all duration-300" />
              {item.label}
            </div>
          </a>
        ))}
      </div>
    </aside>
  );
};
