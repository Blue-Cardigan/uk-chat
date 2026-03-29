import { useEffect, useMemo, useState } from "react";
import { Copy, Download, LogOut } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { ThemePreference } from "@/lib/types";

type ModelUsage = {
  id: string;
  label: string;
  dailyLimit: number;
  used: number;
  remaining: number;
  approaching: boolean;
  reached: boolean;
};

type ModelUsageAllResponse = {
  models?: ModelUsage[];
};

export function SettingsPanel({
  theme,
  onThemeChange,
  authToken,
  mcpToken,
  onExportChats,
  onSignOut,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  authToken: string | null;
  mcpToken: string | null;
  onExportChats: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const masked = mcpToken ? `${mcpToken.slice(0, 6)}...${mcpToken.slice(-4)}` : "No token yet";
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [usageRows, setUsageRows] = useState<ModelUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadUsage() {
      if (!authToken) {
        setUsageRows([]);
        setUsageError(null);
        return;
      }

      setUsageLoading(true);
      setUsageError(null);
      try {
        const response = await fetch("/api/chat/usage/all", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          if (!active) return;
          setUsageError("Could not load model usage right now.");
          return;
        }
        const payload = (await response.json()) as ModelUsageAllResponse;
        if (!active) return;
        setUsageRows(Array.isArray(payload.models) ? payload.models : []);
      } catch {
        if (!active) return;
        setUsageError("Could not load model usage right now.");
      } finally {
        if (active) setUsageLoading(false);
      }
    }

    void loadUsage();
    return () => {
      active = false;
    };
  }, [authToken]);

  const orderedUsageRows = useMemo(() => {
    return [...usageRows].sort((a, b) => b.dailyLimit - a.dailyLimit);
  }, [usageRows]);

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

  async function handleCopyMcpToken() {
    if (!mcpToken || typeof navigator === "undefined") return;
    setActionStatus(null);
    try {
      await navigator.clipboard.writeText(mcpToken);
      setActionStatus("MCP token copied.");
    } catch {
      setActionStatus("Could not copy token right now.");
    }
  }

  function progressClassName(row: ModelUsage) {
    if (row.reached) return "bg-[var(--color-accent)]";
    if (row.approaching) return "bg-amber-500";
    return "bg-[var(--color-primary)]";
  }

  function usageStatusLabel(row: ModelUsage) {
    if (row.reached) return "Reached";
    if (row.approaching) return "Near cap";
    return "Available";
  }

  function usageStatusClassName(row: ModelUsage) {
    if (row.reached) return "border-(--color-accent) text-(--color-accent)";
    if (row.approaching) return "border-amber-500 text-amber-400";
    return "border-(--color-border) text-(--color-muted-foreground)";
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Settings</h3>
        <p className="text-sm text-(--color-muted-foreground)">Manage appearance, access, and daily model caps.</p>
      </header>

      <div className="space-y-5 rounded-xl border border-(--color-border) bg-(--color-card)/65 p-4">
        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Appearance</h4>
          <div className="inline-flex rounded-lg border border-(--color-border) bg-(--color-background) p-1">
            {(["system", "light", "dark"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={
                  theme === option
                    ? "rounded-md bg-(--color-primary) px-3 py-1.5 text-sm font-medium text-(--color-primary-foreground) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                    : "rounded-md px-3 py-1.5 text-sm font-medium text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                }
                onClick={() => onThemeChange(option)}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 border-t border-(--color-border) pt-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Model Usage</h4>
            <span className="text-xs text-(--color-muted-foreground)">Daily caps</span>
          </div>

          {usageLoading ? (
            <p className="animate-pulse text-sm text-(--color-muted-foreground)">Loading model usage...</p>
          ) : null}
          {usageError ? <p className="text-sm text-(--color-muted-foreground)">{usageError}</p> : null}

          {!usageLoading && !usageError ? (
            <div className="space-y-3">
              {orderedUsageRows.map((row) => {
                const percentage = row.dailyLimit > 0 ? Math.min(100, Math.round((row.used / row.dailyLimit) * 100)) : 0;
                return (
                  <div key={row.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-(--color-foreground)">{row.label}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${usageStatusClassName(row)}`}>
                          {usageStatusLabel(row)}
                        </span>
                      </div>
                      <span className="text-(--color-muted-foreground)">{row.used}/{row.dailyLimit}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={row.dailyLimit}
                      aria-valuenow={row.used}
                      aria-label={`${row.label} usage`}
                      className="h-2 w-full overflow-hidden rounded-full bg-(--color-background)"
                    >
                      <div className={`h-full rounded-full transition-[width] duration-300 ease-out ${progressClassName(row)}`} style={{ width: `${percentage}%` }} />
                    </div>
                    {row.reached ? <p className="text-xs text-(--color-muted-foreground)">Daily cap reached for this model.</p> : null}
                  </div>
                );
              })}
              <p className="text-xs text-(--color-muted-foreground)">Resets daily at midnight UTC.</p>
            </div>
          ) : null}
        </section>

        <section className="space-y-2 border-t border-(--color-border) pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">MCP Token</h4>
          <div className="flex items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-background) px-3 py-2">
            <code className="truncate text-xs">{masked}</code>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => {
                void handleCopyMcpToken();
              }}
              aria-label="Copy MCP token"
              disabled={!mcpToken}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </section>

        <section className="space-y-2 border-t border-(--color-border) pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Account</h4>
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
        </section>
      </div>

      {actionStatus ? <p className="text-xs text-(--color-muted-foreground)">{actionStatus}</p> : null}
    </section>
  );
}
