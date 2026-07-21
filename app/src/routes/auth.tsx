import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowLeft, Loader2, Swords } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Sanitize `redirect` at the search boundary: a malicious value (absolute URL,
// //host, @host, embedded scheme) becomes undefined and falls back to the
// default, closing the open-redirect vector in navigate() and OAuth redirectTo.
const searchSchema = z.object({
  redirect: z.string().optional().transform(safeRedirectPath),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Entrar — Hopeland" },
      {
        name: "description",
        content:
          "Acesse sua conta do Hopeland para entrar no mundo sandbox MMO e continuar sua jornada.",
      },
      { property: "og:title", content: "Entrar — Hopeland" },
      {
        property: "og:description",
        content:
          "Entre no Hopeland — MMO sandbox no navegador. Construa, explore e sobreviva.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (data.user) {
        navigate({ to: redirect ?? "/character-creation", replace: true });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        navigate({ to: redirect ?? "/character-creation", replace: true });
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate, redirect]);

  async function handleGoogle() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${redirect ?? "/character-creation"}`,
        },
      });
      if (error) {
        toast.error("Falha ao entrar com Google", {
          description: error.message,
        });
        setLoading(false);
        return;
      }
      // On success, Supabase redirects the browser away to Google —
      // nothing else to do here.
    } catch {
      toast.error("Erro inesperado ao entrar");
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="absolute inset-x-0 top-1/3 -z-10 mx-auto h-[40rem] max-w-4xl bg-primary/20 opacity-40 blur-3xl rounded-full"
        aria-hidden
      />
      <header className="mx-auto max-w-7xl px-6 py-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
      </header>

      <main className="mx-auto flex max-w-md flex-col items-center px-6 pb-24 pt-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary shadow-lg">
          <Swords className="h-7 w-7 text-primary-foreground" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-extrabold sm:text-4xl">
          Entre no <span className="text-primary">Hopeland</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Acesse sua conta para entrar no mundo — sua jornada continua onde parou.
        </p>

        <div className="mt-10 w-full rounded-2xl border bg-card/50 backdrop-blur p-6">
          <Button
            size="lg"
            onClick={handleGoogle}
            disabled={loading}
            className="w-full bg-white text-slate-900 hover:bg-white/90"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleIcon className="h-5 w-5" />
            )}
            <span className="ml-2 font-semibold">Continuar com Google</span>
          </Button>

          <p className="mt-6 text-xs text-muted-foreground">
            Ao continuar, você concorda com os termos de uso da plataforma.
          </p>
        </div>
      </main>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
