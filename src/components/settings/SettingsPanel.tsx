import { useState } from "react";
import { Copy, Download, LogOut } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { ThemePreference } from "@/lib/types";

export function SettingsPanel({
  theme,
  onThemeChange,
  mcpToken,
  onExportChats,
  onSignOut,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  mcpToken: string | null;
  onExportChats: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const masked = mcpToken ? `${mcpToken.slice(0, 6)}...${mcpToken.slice(-4)}` : "No token yet";
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleExportChats() {
    setActionStatus(null);
    setIsExporting(true);
    try {
      await onExportChats();
      setActionStatus("Chat export downloaded.");
    } catch {
      setActionStatus("Could not export chats right now.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSignOut() {
    setActionStatus(null);
    setIsSigningOut(true);
    try {
      await onSignOut();
    } catch {
      setActionStatus("Could not sign out right now.");
      setIsSigningOut(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Settings</h3>
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
        <div className="flex items-center justify-between rounded-md border border-(--color-border) px-3 py-2">
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
      <div className="space-y-2 text-sm">
        <p>Account</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void handleExportChats()} disabled={isExporting || isSigningOut}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export chats"}
          </Button>
          <Button variant="accent" onClick={() => void handleSignOut()} disabled={isSigningOut || isExporting}>
            <LogOut className="mr-2 h-4 w-4" />
            {isSigningOut ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      </div>
      {actionStatus ? <p className="text-xs text-(--color-muted-foreground)">{actionStatus}</p> : null}
    </div>
  );
}
