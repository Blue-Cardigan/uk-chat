import { Copy } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import type { ThemePreference } from "@/lib/types";

export function SettingsPanel({
  theme,
  onThemeChange,
  mcpToken,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  mcpToken: string | null;
}) {
  const masked = mcpToken ? `${mcpToken.slice(0, 6)}...${mcpToken.slice(-4)}` : "No token yet";
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Settings</h3>
      <div className="space-y-2 text-sm">
        <p>Theme</p>
        <div className="flex gap-2">
          {(["system", "light", "dark"] as const).map((option) => (
            <Button key={option} variant={theme === option ? "default" : "secondary"} onClick={() => onThemeChange(option)}>
              {option}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <p>MCP token</p>
        <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2">
          <code className="text-xs">{masked}</code>
          <Button
            variant="ghost"
            onClick={() => {
              if (mcpToken) void navigator.clipboard.writeText(mcpToken);
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
