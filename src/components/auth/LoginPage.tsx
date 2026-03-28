import { useState } from "react";
import { Input, Button, Card } from "@/components/ui/primitives";
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    const response = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string; allowed?: boolean };
    setLoading(false);
    if (!response.ok) {
      setStatus(payload.error ?? payload.message ?? "Unable to verify email");
      return;
    }
    if (payload.allowed) {
      setStatus(payload.message ?? "Email recognized. Check your inbox for your magic link.");
      return;
    }
    setStatus(payload.message ?? "Email not found. Ask your admin to add you.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-(--color-background) p-4">
      <Card className="w-full max-w-md space-y-4">
        <h1 className="font-display text-2xl">Sign in</h1>
        <p className="text-sm text-(--color-muted-foreground)">Not set up yet? Contact <a href="mailto:jethro@explorethekingdom.co.uk">Jethro</a> to get access.</p>
        <form onSubmit={handleLogin} className="space-y-3">
          <Input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Checking..." : "Check email access"}
          </Button>
        </form>
        {status ? <p className="text-xs text-(--color-muted-foreground)">{status}</p> : null}
      </Card>
    </main>
  );
}
