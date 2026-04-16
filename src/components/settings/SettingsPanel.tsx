import { useEffect, useMemo, useState } from "react";
import { Copy, Download, LogOut, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/primitives";
import { apiFetchJson } from "@/lib/api";
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

type PrivacyConsentResponse = {
  privacyNoticeVersion?: string | null;
  aiProcessingAcknowledgedAt?: string | null;
  currentVersion?: string;
};
type ActionStatus = { type: "success" | "error"; message: string } | null;

const MCP_SERVER_URL = "https://mcp.explorethekingdom.co.uk/sse";

export function SettingsPanel({
  theme,
  onThemeChange,
  authToken,
  mcpToken,
  onExportChats,
  onDeleteAccount,
  onSignOut,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  authToken: string | null;
  mcpToken: string | null;
  onExportChats: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const masked = mcpToken ? `${mcpToken.slice(0, 6)}...${mcpToken.slice(-4)}` : "No token yet";
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState<PrivacyConsentResponse | null>(null);
  const [consentPending, setConsentPending] = useState(false);
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
        const payload = await apiFetchJson<ModelUsageAllResponse>("/api/chat/usage/all", {
          skipToast: true,
        });
        if (!active) return;
        setUsageRows(Array.isArray(payload.models) ? payload.models : []);
      } catch {
        if (!active) return;
        setUsageError("Usage data is not available right now. Try refreshing.");
      } finally {
        if (active) setUsageLoading(false);
      }
    }

    void loadUsage();
    return () => {
      active = false;
    };
  }, [authToken]);

  useEffect(() => {
    let active = true;
    async function loadConsent() {
      if (!authToken) {
        if (active) setPrivacyConsent(null);
        return;
      }
      try {
        const payload = await apiFetchJson<PrivacyConsentResponse>("/api/privacy/consent", {
          skipToast: true,
        });
        if (active) setPrivacyConsent(payload);
      } catch {
        // Privacy banner is non-critical; ignore transient failures.
      }
    }
    void loadConsent();
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
      setActionStatus({ type: "success", message: "Chat export downloaded." });
    } catch {
      setActionStatus({ type: "error", message: "Could not export chats right now." });
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
      setActionStatus({ type: "error", message: "Could not sign out right now." });
      setIsSigningOut(false);
    }
  }

  async function handleDeleteAccount() {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete your account and all associated data? This cannot be undone.");
      if (!confirmed) return;
    }
    setActionStatus(null);
    setIsDeletingAccount(true);
    try {
      await onDeleteAccount();
    } catch {
      setActionStatus({ type: "error", message: "Could not delete your account right now." });
      setIsDeletingAccount(false);
    }
  }

  async function handleCopyMcpToken() {
    if (!mcpToken || typeof navigator === "undefined") return;
    setActionStatus(null);
    try {
      await navigator.clipboard.writeText(mcpToken);
      setActionStatus({ type: "success", message: "Developer token copied." });
    } catch {
      setActionStatus({ type: "error", message: "Could not copy token right now." });
    }
  }

  async function handleCopyMcpServerUrl() {
    if (typeof navigator === "undefined") return;
    setActionStatus(null);
    try {
      await navigator.clipboard.writeText(MCP_SERVER_URL);
      setActionStatus({ type: "success", message: "Server URL copied." });
    } catch {
      setActionStatus({ type: "error", message: "Could not copy server URL right now." });
    }
  }

  async function acknowledgePrivacyNotice() {
    if (!authToken) return;
    setConsentPending(true);
    setActionStatus(null);
    try {
      const payload = await apiFetchJson<PrivacyConsentResponse>("/api/privacy/consent", {
        method: "PUT",
        body: JSON.stringify({
          acknowledgeAiProcessing: true,
          acknowledgeSharingWarning: true,
        }),
      });
      setPrivacyConsent(payload);
      setActionStatus({ type: "success", message: "Privacy acknowledgement saved." });
    } catch {
      setActionStatus({ type: "error", message: "Could not save privacy acknowledgement." });
    } finally {
      setConsentPending(false);
    }
  }

  function progressClassName(row: ModelUsage) {
    if (row.reached) return "bg-[var(--color-accent)]";
    if (row.approaching) return "bg-[var(--color-warning)]";
    return "bg-[var(--color-primary)]";
  }

  function usageStatusLabel(row: ModelUsage) {
    if (row.reached) return "Reached";
    if (row.approaching) return "Near cap";
    return "Available";
  }

  function usageStatusClassName(row: ModelUsage) {
    if (row.reached) return "border-(--color-accent) text-(--color-accent)";
    if (row.approaching) return "border-(--color-warning) text-(--color-warning)";
    return "border-(--color-border) text-(--color-muted-foreground)";
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Settings</h3>
        <p className="text-sm text-(--color-muted-foreground)">Manage appearance, access, and daily model caps.</p>
      </header>

      <div className="space-y-5 rounded-xl border border-(--color-border) bg-(--color-card)/65 p-4">
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Privacy</h4>
          <p className="text-xs text-(--color-muted-foreground)">
            Chat and document content is processed by model/tool providers to answer your prompts.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/privacy" className="text-xs underline text-(--color-primary)">
              Read Privacy Notice
            </Link>
            {privacyConsent?.aiProcessingAcknowledgedAt ? (
              <span className="text-xs text-(--color-muted-foreground)">Acknowledged</span>
            ) : (
              <Button type="button" variant="secondary" className="h-7 text-xs" onClick={() => void acknowledgePrivacyNotice()} disabled={consentPending}>
                {consentPending ? "Saving..." : "I understand"}
              </Button>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Appearance</h4>
          <div className="inline-flex rounded-lg border border-(--color-border) bg-(--color-background) p-1">
            {(["system", "light", "dark"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={theme === option}
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

        <section className="space-y-3 border-t border-(--color-border) pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">MCP Connection</h4>
          <p className="text-xs text-(--color-muted-foreground)">
            Add ChatGB as an MCP server in Claude Desktop, Cursor, or any other MCP-compatible client using the URL and token below.
          </p>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-(--color-muted-foreground)">Server URL</label>
            <div className="flex items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-background) px-3 py-2">
              <code className="truncate text-xs">{MCP_SERVER_URL}</code>
              <Button
                type="button"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => {
                  void handleCopyMcpServerUrl();
                }}
                aria-label="Copy MCP server URL"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-(--color-muted-foreground)">Developer Token</label>
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
          </div>
        </section>

        <section className="space-y-2 border-t border-(--color-border) pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Account</h4>
          <p className="text-xs text-(--color-muted-foreground)">
            Exports include your profile, chats, councils, usage data, and consent records.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void handleExportChats()} disabled={isExporting || isSigningOut || isDeletingAccount}>
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export chats"}
            </Button>
            <Button variant="accent" onClick={() => void handleSignOut()} disabled={isSigningOut || isExporting || isDeletingAccount}>
              <LogOut className="mr-2 h-4 w-4" />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
            <Button variant="ghost" onClick={() => void handleDeleteAccount()} disabled={isSigningOut || isExporting || isDeletingAccount}>
              <Trash2 className="mr-2 h-4 w-4 text-(--color-accent)" />
              {isDeletingAccount ? "Deleting..." : "Delete account"}
            </Button>
          </div>
        </section>
      </div>

      {actionStatus ? (
        <p role="status" className={actionStatus.type === "error" ? "text-xs text-(--color-accent)" : "text-xs text-(--color-muted-foreground)"}>
          {actionStatus.message}
        </p>
      ) : null}
    </section>
  );
}
