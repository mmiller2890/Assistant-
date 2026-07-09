import { Loader2 } from "lucide-react";

export const SttInitOverlay = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
    <div className="flex flex-col items-center gap-3 p-6 rounded-lg border border-border bg-card shadow-lg">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <div className="text-center">
        <p className="text-sm font-medium">Preparing local speech model</p>
        <p className="text-xs text-muted-foreground mt-1">
          First run may take 20–30 seconds
        </p>
      </div>
    </div>
  </div>
);
