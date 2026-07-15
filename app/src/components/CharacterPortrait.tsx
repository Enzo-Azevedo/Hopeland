// app/src/components/CharacterPortrait.tsx
import { useEffect, useRef } from "react";
import type { Appearance } from "@/lib/character-schema";
import { selectPortraitLayers } from "@/lib/portrait-selection";
import { compositePortrait, loadManifest } from "./portrait/composite";
import { drawFallbackPortrait } from "./portrait/fallback";

export interface CharacterPortraitProps {
  appearance: Appearance;
  mood: number;
  size?: number;
  className?: string;
  label?: string;
}

export function CharacterPortrait({ appearance, mood, size = 192, className, label }: CharacterPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    // Render the canvas backing store at device-pixel resolution while
    // keeping CSS size at `size` (see style prop below), so portraits stay
    // sharp on high-DPI screens. Set imperatively (not via JSX width/height)
    // to avoid an SSR/client hydration mismatch on devicePixelRatio.
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    // Legacy characters created before the seed field exist in
    // sessionStorage; they keep the geometric portrait.
    if (typeof appearance.seed !== "number") {
      drawFallbackPortrait(canvas, appearance, mood);
      return;
    }

    drawFallbackPortrait(canvas, appearance, mood); // placeholder while layers load
    loadManifest()
      .then((manifest) => {
        if (cancelled) return;
        return compositePortrait(canvas, selectPortraitLayers(appearance, mood, manifest), () => cancelled);
      })
      .catch((error) => {
        console.error("[portrait] falling back to geometric render:", error);
        if (!cancelled && canvasRef.current) drawFallbackPortrait(canvasRef.current, appearance, mood);
      });

    return () => { cancelled = true; };
  }, [appearance, mood, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={className}
      role="img"
      aria-label={label ?? "Retrato do personagem"}
    />
  );
}
