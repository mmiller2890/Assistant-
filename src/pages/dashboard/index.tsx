import { useApp } from "@/contexts";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "@/layouts";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@/components";
import {
  Sparkles,
  Mic,
  Settings,
  MessageSquare,
  WandSparkles,
  Monitor,
  AudioLines,
  SquareSlash,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

const Welcome = () => {
  const { selectedAIProvider, selectedSttProvider, allAiProviders, allSttProviders } =
    useApp();
  const navigate = useNavigate();

  const aiProvider = allAiProviders.find((p) => p.id === selectedAIProvider.provider);
  const sttProvider = allSttProviders.find((p) => p.id === selectedSttProvider.provider);
  const aiModel = selectedAIProvider.variables?.MODEL || "Not set";
  const aiReady = !!selectedAIProvider.provider && !!aiModel;
  const sttReady = !!selectedSttProvider.provider;

  const quickActions = [
    {
      icon: MessageSquare,
      label: "Chats",
      description: "Start a conversation with your AI",
      href: "/chats",
      color: "text-blue-500",
    },
    {
      icon: WandSparkles,
      label: "System Prompts",
      description: "Customize your AI's behavior",
      href: "/system-prompts",
      color: "text-violet-500",
    },
    {
      icon: Settings,
      label: "Dev Space",
      description: "Configure AI & STT providers",
      href: "/dev-space",
      color: "text-amber-500",
    },
    {
      icon: Monitor,
      label: "Screenshot",
      description: "Capture & analyze your screen",
      href: "/screenshot",
      color: "text-emerald-500",
    },
    {
      icon: AudioLines,
      label: "Audio",
      description: "Manage audio input devices",
      href: "/audio",
      color: "text-pink-500",
    },
    {
      icon: SquareSlash,
      label: "Cursor & Shortcuts",
      description: "Tweak cursor and hotkeys",
      href: "/shortcuts",
      color: "text-cyan-500",
    },
  ];

  return (
    <PageLayout
      title="Welcome"
      description="Your privacy-first AI assistant — everything runs locally."
    >
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-background to-background p-8">
        <div className="absolute -top-12 -right-12 opacity-10">
          <Sparkles className="size-48 text-primary" />
        </div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Sparkles className="size-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Lightning-fast, privacy-first AI for meetings, interviews & conversations.
            </p>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* AI Provider Status */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <Sparkles className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm">AI Provider</CardTitle>
                <p className="text-xs text-muted-foreground">Language model</p>
              </div>
            </div>
            {aiReady ? (
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Ready
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1">
                <AlertCircle className="size-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Not configured
                </span>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium capitalize">
                  {aiProvider?.id || "None selected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Model: <span className="font-mono">{aiModel}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => navigate("/dev-space")}
              >
                Configure
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* STT Provider Status */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Mic className="size-5 text-blue-500" />
              </div>
              <div>
                <CardTitle className="text-sm">Speech to Text</CardTitle>
                <p className="text-xs text-muted-foreground">Transcription engine</p>
              </div>
            </div>
            {sttReady ? (
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Ready
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1">
                <AlertCircle className="size-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Not configured
                </span>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {sttProvider?.id || "None selected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sttProvider?.id?.startsWith("local-")
                    ? "Running locally"
                    : sttReady
                      ? "Cloud provider"
                      : "Select a provider to enable voice input"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => navigate("/dev-space")}
              >
                Configure
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground px-1">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => (
            <button
              key={action.href}
              onClick={() => navigate(action.href)}
              className="group flex items-center gap-3 rounded-xl border border-border/60 p-4 text-left transition-all hover:border-primary/30 hover:bg-accent/40"
            >
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 ${action.color}`}
              >
                <action.icon className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{action.label}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {action.description}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>
    </PageLayout>
  );
};

export default Welcome;