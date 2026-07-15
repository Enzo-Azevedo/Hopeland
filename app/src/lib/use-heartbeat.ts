// Sends a playtime tick every 60s while the tab is visible. Server-side
// throttling makes duplicate/racy ticks harmless; missed ticks are fine.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { heartbeat } from "./character.functions";
import { updateActiveCharacter } from "./character-store";

const TICK_MS = 60_000;

export function useHeartbeat(enabled: boolean, onDeath?: () => void): void {
  const tick = useServerFn(heartbeat);
  const onDeathRef = useRef(onDeath);
  onDeathRef.current = onDeath;

  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      tick()
        .then((result) => {
          if (!result) return;
          updateActiveCharacter({ playedSeconds: result.playedSeconds });
          if (result.dead) onDeathRef.current?.();
        })
        .catch(() => { /* falha de rede: tenta no próximo tick */ });
    };
    const id = setInterval(send, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, tick]);
}
