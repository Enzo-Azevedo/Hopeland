// Age is derived from accumulated active playtime; never stored.
export type AgeStage = "c" | "t" | "y" | "m" | "e";

const H = 3600;
const TEEN_AT = 8 * H;
const YOUNG_AT = 24 * H;
const MIDDLE_AT = 84 * H;
const ELDER_AT = 234 * H;
export const DEATH_SECONDS = 284 * H;

export function ageStage(playedSeconds: number): AgeStage {
  if (playedSeconds < TEEN_AT) return "c";
  if (playedSeconds < YOUNG_AT) return "t";
  if (playedSeconds < MIDDLE_AT) return "y";
  if (playedSeconds < ELDER_AT) return "m";
  return "e";
}

export function isDeadByAge(playedSeconds: number): boolean {
  return playedSeconds >= DEATH_SECONDS;
}

const LABELS: Record<AgeStage, string> = {
  c: "Criança", t: "Adolescente", y: "Jovem adulto", m: "Meia-idade", e: "Idoso",
};

export function stageLabel(stage: AgeStage): string {
  return LABELS[stage];
}
