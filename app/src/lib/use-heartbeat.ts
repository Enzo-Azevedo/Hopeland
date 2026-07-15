// Sends a playtime tick every 60s while the tab is visible. Server-side
// throttling makes duplicate/racy ticks harmless; missed ticks are fine.
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { heartbeat } from "./character.functions";
import { updateActiveCharacter } from "./character-store";

const TICK_MS = 60_000;

export function useHeartbeat(enabled: boolean): void {
  const tick = useServerFn(heartbeat);
  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      tick()
        .then((result) => {
          if (result) updateActiveCharacter({ playedSeconds: result.playedSeconds });
        })
        .catch(() => { /* falha de rede: tenta no próximo tick */ });
    };
    const id = setInterval(send, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, tick]);
}
