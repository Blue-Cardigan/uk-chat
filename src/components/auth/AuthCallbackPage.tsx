import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().finally(() => {
      navigate("/", { replace: true });
    });
  }, [navigate]);

  return (
    <main aria-live="polite" className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-(--color-muted-foreground)">Finishing sign in...</p>
    </main>
  );
}
