// Deterministic per-tile texture variant selection.
//
// The hash needs full avalanche in the LOW bits: a weak finalizer makes the
// variant index track tile parity and the world renders as a checkerboard
// (bug seen in production). fmix32 (murmur3 finalizer) avalanches every bit.

export function tileHash(tx: number, ty: number): number {
  let h = (Math.imul(tx, 0x9e3779b1) ^ Math.imul(ty, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Variants are accents, not a 50/50 mix: the primary frame dominates so
// terrain reads as one material with occasional texture breaks.
const VARIANT_CHANCE = 0.2;

export function pickVariant(frames: readonly number[], tx: number, ty: number): number {
  if (frames.length === 1) return frames[0]!;
  const h = tileHash(tx, ty);
  if (h % 1000 >= VARIANT_CHANCE * 1000) return frames[0]!;
  // Spread the accent tiles across the remaining variants.
  return frames[1 + (Math.floor(h / 1000) % (frames.length - 1))]!;
}
