import { Link } from "react-router-dom";
import { Card } from "@/components/ui/primitives";

export function PrivacyNoticePage() {
  return (
    <main className="min-h-screen overflow-y-auto bg-(--color-background) px-4 py-8 text-(--color-foreground)">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-(--color-muted-foreground)">ChatGB</p>
          <h1 className="font-display text-4xl">Privacy Notice</h1>
          <p className="text-sm text-(--color-muted-foreground)">Last updated: 2026-03-30</p>
        </header>

        <Card className="space-y-4">
          <p className="text-sm text-(--color-muted-foreground)">
            We process your account email, chat content, uploaded document extracts, and council mode inputs so the product can authenticate you,
            answer prompts, and provide auditing/export/delete functionality.
          </p>
          <p className="text-sm text-(--color-muted-foreground)">
            Chat and document content is sent to our model and tooling providers to generate responses. Public share links expose only the
            conversations you explicitly share.
          </p>
          <p className="text-sm text-(--color-muted-foreground)">
            You can export your data and delete your account from Settings. Deleting your account removes your profile and associated
            conversations via cascading deletes.
          </p>
          <p className="text-sm text-(--color-muted-foreground)">
            For privacy requests, contact <a href="mailto:privacy@explorethekingdom.co.uk" className="underline">privacy@explorethekingdom.co.uk</a>.
          </p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Processors</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-(--color-muted-foreground)">
            <li>Supabase (authentication and data storage)</li>
            <li>OpenRouter (LLM inference)</li>
            <li>Resend (transactional email)</li>
            <li>MCP infrastructure (tooling and token issuance)</li>
          </ul>
        </Card>

        <div className="flex gap-2">
          <Link to="/login" className="text-sm underline text-(--color-primary)">
            Back to sign in
          </Link>
          <Link to="/" className="text-sm underline text-(--color-primary)">
            Back to app
          </Link>
        </div>
      </div>
    </main>
  );
}
