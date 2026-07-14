// Deterministic portrait layer selection. All randomness comes from
// appearance.seed via mulberry32; the draw order below is a stable
// contract — append new draws at the end, never reorder.
import { moodExpression, type Appearance, type SkinTone } from "./character-schema";

export type TintKind = "skin" | "hair" | null;

export interface PortraitManifest {
  version: number;
  size: number;
  credit: string;
  layers: Record<string, { tint: TintKind; variants: Record<string, string> }>;
}

export interface SelectedLayer { layer: string; url: string; tint: string | null }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genderFromSeed(seed: number): "f" | "m" {
  return mulberry32(seed)() < 0.5 ? "f" : "m";
}

export const SKIN_COLOR: Record<SkinTone, string> = {
  warm_tan:     "#d2a074",
  pale_flushed: "#f0d3c4",
  earth_deep:   "#8b5a3c",
  light_brown:  "#b98764",
  very_pale:    "#f4e0d3",
  gray_tan:     "#b39683",
  neutral:      "#c99b7a",
};

export const HAIR_COLORS = [
  "#2b2118", "#4a3222", "#6b4a2f", "#8a4b32", "#c9a55c", "#9b9184",
];

const HEAD_SHAPES = [
  "averagenormal", "averagepointy", "averagewide",
  "narrownormal", "narrowpointy", "narrowwide",
];

const NECK_BY_BUILD: Record<Appearance["build"], string> = {
  slim: "thin", average: "average", sturdy: "heavy", robust: "hulk",
};

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function selectPortraitLayers(
  appearance: Appearance,
  mood: number,
  manifest: PortraitManifest,
): SelectedLayer[] {
  const rand = mulberry32(appearance.seed);
  // Draw order contract (see header). Gender is draw #1 so it always
  // matches genderFromSeed(seed).
  const gender = rand() < 0.5 ? "f" : "m";
  const headShape = pick(rand, HEAD_SHAPES);
  const hairVariant = pick(rand, Object.keys(manifest.layers.hair.variants));
  const hairColor = pick(rand, HAIR_COLORS);
  const hasBeard = rand() < 0.5;
  const beardVariant = pick(rand, Object.keys(manifest.layers.beard.variants));
  const faceBucketVariant = { low: 1 + Math.floor(rand() * 3), mid: 1 + Math.floor(rand() * 3), high: 1 + Math.floor(rand() * 3) };

  const skin = SKIN_COLOR[appearance.skinTone];
  const bucket = moodExpression(mood);

  const wanted: Record<string, string | null> = {
    neck: `${gender}-${NECK_BY_BUILD[appearance.build]}`,
    clothes: appearance.clothes,
    head: `${gender}-${headShape}`,
    face: `${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    "face-inner": `${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    "face-outer": `${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    beard: gender === "m" && hasBeard ? beardVariant : null,
    hair: hairVariant,
  };

  const out: SelectedLayer[] = [];
  for (const [layer, def] of Object.entries(manifest.layers)) {
    const variant = wanted[layer];
    if (variant == null) continue;
    const file = def.variants[variant];
    if (!file) {
      throw new Error(`portrait manifest: layer "${layer}" has no variant "${variant}"`);
    }
    out.push({
      layer,
      url: `/portraits/${file}`,
      tint: def.tint === "skin" ? skin : def.tint === "hair" ? hairColor : null,
    });
  }
  return out;
}
