import { useState } from "react";
import { Navigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Input, Button, Card } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
export function LoginPage() {
  const { session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) {
    return <Navigate to="/" replace />;
  }

  const statusToneClass =
    status && status.toLowerCase().includes("unable")
      ? "text-[color-mix(in_oklch,var(--color-accent)_80%,var(--color-foreground)_20%)]"
      : "text-(--color-muted-foreground)";

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      allowed?: boolean;
      redirectTo?: string;
    };
    setLoading(false);
    if (!response.ok) {
      setStatus(payload.error ?? payload.message ?? "Unable to verify email");
      return;
    }
    if (payload.allowed === false) {
      setStatus(payload.message ?? "Email not found. Ask Jethro to get you access.");
      return;
    }
    if (payload.redirectTo) {
      window.location.assign(payload.redirectTo);
      return;
    }
    setStatus("Unable to sign in right now. Please try again.");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--color-background) p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-12 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "color-mix(in oklch, var(--color-primary) 30%, transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "color-mix(in oklch, var(--color-accent) 26%, transparent)" }}
      />

      <Card className="relative w-full max-w-xl overflow-hidden p-0">
        <div className="border-b border-(--color-border) bg-[linear-gradient(120deg,color-mix(in_oklch,var(--color-primary)_14%,var(--color-card)_86%)_0%,color-mix(in_oklch,var(--color-accent)_10%,var(--color-card)_90%)_100%)] px-6 py-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-(--color-muted-foreground)">Explore the Kingdom</p>
          <h1 className="font-display text-4xl leading-none">Sign in</h1>
          <p className="mt-3 max-w-md text-sm text-(--color-muted-foreground)">
            Ask UK questions and get answers grounded in live data, maps, and policy context.
          </p>
        </div>

        <div className="space-y-4 px-6 py-6">
          <form onSubmit={handleLogin} className="space-y-3">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-muted-foreground)">
              Work email
            </label>
            <Input
              id="email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" disabled={loading || authLoading} className="w-full justify-between">
              <span>{loading || authLoading ? "Signing in..." : "Enter"}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <p className="text-sm text-(--color-muted-foreground)">
            Not set up yet? Contact{" "}
            <a href="mailto:jethro@explorethekingdom.co.uk" className="font-medium text-(--color-foreground) underline decoration-(--color-border) underline-offset-4">
              Jethro
            </a>{" "}
            to get access.
          </p>

          {status ? <p className={`text-xs ${statusToneClass}`}>{status}</p> : null}
        </div>
      </Card>
    </main>
  );
}
