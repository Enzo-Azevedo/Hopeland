// No terrain blocks movement — that is the anti-trap guarantee. Terrain and
// climb fatigue only scale speed, and every multiplier is strictly positive.

import type { Terrain } from "./world-gen";

export const TERRAIN_SPEED: Record<Terrain, number> = {
  deep_water: 0.35,
  water: 0.45,
  river: 0.45,
  beach: 1,
  grass: 1,
  forest: 1,
  jungle: 1,
  swamp: 0.8,
  desert: 1,
  savanna: 1,
  tundra: 1,
  snow: 0.9,
  taiga: 1,
  rock: 1,
  snow_rock: 0.9,
};

const RAMP_UP_MS = 4000; // 0 -> full fatigue while climbing
const RECOVER_MS = 2000; // full -> 0 on flat/downhill
const MIN_MULTIPLIER = 0.4;

export class FatigueTracker {
  private fatigue = 0; // 0..1

  update(deltaMs: number, climbing: boolean): void {
    if (climbing) this.fatigue += deltaMs / RAMP_UP_MS;
    else this.fatigue -= deltaMs / RECOVER_MS;
    this.fatigue = Math.min(1, Math.max(0, this.fatigue));
  }

  get multiplier(): number {
    return 1 - (1 - MIN_MULTIPLIER) * this.fatigue;
  }
}
