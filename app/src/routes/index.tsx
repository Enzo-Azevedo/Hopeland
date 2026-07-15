import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => {
        navigate({ to: data.session ? "/character-creation" : "/auth", replace: true });
      })
      .catch((error) => {
        // Sem cliente Supabase utilizável, trate como não autenticado em vez
        // de deixar o usuário preso no "Carregando...".
        console.error("[auth] session check failed:", error);
        navigate({ to: "/auth", replace: true });
      });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      Carregando...
    </div>
  );
}
