import { useState } from "react";
import { Sidebar } from "@/components";
import { Outlet } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "./ErrorLayout";
import { PanelLeftOpenIcon } from "lucide-react";

export const DashboardLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout />;
      }}
      resetKeys={["dashboard-error"]}
      onReset={() => {}}
    >
      <div className="relative flex h-screen w-screen overflow-hidden bg-background">
        {/* Draggable region */}
        <div
          className="absolute left-0 right-0 top-0 z-50 h-10 select-none"
          data-tauri-drag-region={true}
        />

        {/* Sidebar (collapsible) */}
        {sidebarCollapsed ? (
          <button
            onClick={() => setSidebarCollapsed(false)}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="absolute left-0 top-12 z-40 flex h-9 w-6 items-center justify-center border-y border-r border-sidebar-border bg-sidebar text-muted-foreground transition-colors hover:text-primary"
          >
            <PanelLeftOpenIcon className="size-4" />
          </button>
        ) : (
          <Sidebar onCollapse={() => setSidebarCollapsed(true)} />
        )}
        {/* Main Content */}
        <main className="flex flex-1 flex-col overflow-hidden px-8">
          <Outlet />
        </main>
      </div>
    </ErrorBoundary>
  );
};
