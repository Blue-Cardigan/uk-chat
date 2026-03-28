import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";

type AdminUser = { email: string; status: string; hasToken: boolean };

export function AdminPanel() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((response) => response.json())
      .then((data: AdminUser[]) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => setUsers([]));
  }, [session?.access_token]);

  async function inviteUser(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.access_token) return;
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ email }),
    });
    const payload = (await response.json()) as { message?: string; user?: AdminUser };
    if (payload.user) {
      setUsers((previous) => [payload.user as AdminUser, ...previous]);
    }
    setMessage(payload.message ?? "Invite sent");
    setEmail("");
  }

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Admin Setup</h3>
      <form onSubmit={inviteUser} className="flex gap-2">
        <Input type="email" required placeholder="new-user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit">Invite</Button>
      </form>
      {message ? <p className="text-xs text-[var(--color-muted-foreground)]">{message}</p> : null}
      <div className="space-y-2">
        {users.map((user) => (
          <Card key={user.email} className="flex items-center justify-between p-3 text-xs">
            <span>{user.email}</span>
            <span>{user.hasToken ? "Token issued" : "Pending token"}</span>
          </Card>
        ))}
      </div>
    </Card>
  );
}
