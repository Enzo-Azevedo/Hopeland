import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PhaserGame } from "@/components/PhaserGame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CharacterPortrait } from "@/components/CharacterPortrait";
import { loadActiveCharacter, updateActiveCharacter } from "@/lib/character-store";
import { setCharacterMoodDebug } from "@/lib/character.functions";
import type { Character } from "@/lib/character-schema";

const DEV = import.meta.env.DEV;

export const Route = createFileRoute("/game")({
  head: () => ({
    meta: [
      { title: "Mundo — Sandbox MMO" },
      { name: "description", content: "Explore o mundo sandbox." },
    ],
  }),
  component: GamePage,
});

function GamePage() {
  const navigate = useNavigate();
  const setMoodFn = useServerFn(setCharacterMoodDebug);
  const [email, setEmail] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!data.session) {
          navigate({ to: "/auth" });
          return;
        }
        setEmail(data.session.user.email ?? null);
      })
      .catch((error) => {
        console.error("[auth] session check failed:", error);
        navigate({ to: "/auth" });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const c = loadActiveCharacter();
    if (!c || !c.name) {
      navigate({ to: "/character-creation" });
      return;
    }
    setCharacter(c);
  }, [navigate]);

  const handlePosition = useCallback((x: number, y: number) => {
    setPos({ x, y });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const handleMoodChange = async (value: number) => {
    try {
      const { mood } = await setMoodFn({ data: { mood: value } });
      const next = updateActiveCharacter({ mood });
      if (next) setCharacter(next);
    } catch {
      // ignore debug failures
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <PhaserGame onPositionChange={handlePosition} />

      {/* HUD top-left: session info */}
      <Card className="absolute top-4 left-4 p-3 space-y-1 text-xs bg-background/85 backdrop-blur">
        <div><span className="text-muted-foreground">Conta:</span> {email ?? "—"}</div>
        {character?.name && (
          <div><span className="text-muted-foreground">Personagem:</span> {character.name}</div>
        )}
        {pos && (
          <div className="text-muted-foreground">
            pos: ({pos.x.toFixed(0)}, {pos.y.toFixed(0)})
          </div>
        )}
        <div className="text-muted-foreground pt-1">Mova com WASD</div>
      </Card>

      {/* HUD bottom-left: character portrait */}
      {character && (
        <div className="absolute bottom-4 left-4 flex items-end gap-3">
          <div className="rounded-lg border border-border bg-background/85 backdrop-blur p-2 shadow-lg">
            <CharacterPortrait
              appearance={character.appearance}
              mood={character.mood}
              size={96}
              label={`Retrato de ${character.name ?? "personagem"}`}
            />
            <div className="mt-1 text-center text-[11px] font-medium">
              {character.name}
            </div>
          </div>
          {DEV && (
            <Card className="p-2 text-[11px] bg-background/85 backdrop-blur space-y-1 w-40">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mood (debug)</span>
                <span className="tabular-nums">{character.mood}</span>
              </div>
              <input
                type="range" min={0} max={100} value={character.mood}
                onChange={(e) => handleMoodChange(Number(e.target.value))}
                className="w-full"
                aria-label="Mood do personagem (debug)"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>triste</span><span>neutro</span><span>animado</span>
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="absolute top-4 right-4">
        <Button size="sm" variant="secondary" onClick={handleSignOut}>Sair</Button>
      </div>
    </div>
  );
}
