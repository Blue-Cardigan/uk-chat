import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { apiFetchJson } from "@/lib/api";

type AdminUser = { email: string; status: string; hasToken: boolean };

export function AdminPanel() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;
    setUsersLoading(true);
    setUsersError(null);
    apiFetchJson<AdminUser[]>("/api/admin/users", { skipToast: true })
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {
        setUsers([]);
        setUsersError("Could not load invited users right now.");
      })
      .finally(() => setUsersLoading(false));
  }, [session?.access_token]);

  async function inviteUser(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.access_token) return;
    try {
      const payload = await apiFetchJson<{ message?: string; user?: AdminUser }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (payload.user) {
        setUsers((previous) => [payload.user as AdminUser, ...previous]);
      }
      setMessage(payload.message ?? "Invite sent");
      setEmail("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invite failed");
    }
  }

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Admin Setup</h3>
      <form onSubmit={inviteUser} className="flex gap-2">
        <label htmlFor="admin-invite-email" className="sr-only">
          Invite email
        </label>
        <Input
          id="admin-invite-email"
          type="email"
          required
          placeholder="new-user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit">Invite</Button>
      </form>
      {message ? <p className="text-xs text-(--color-muted-foreground)">{message}</p> : null}
      {usersLoading ? <p className="text-xs text-(--color-muted-foreground)">Loading users...</p> : null}
      {usersError ? <p role="alert" className="text-xs text-(--color-muted-foreground)">{usersError}</p> : null}
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
