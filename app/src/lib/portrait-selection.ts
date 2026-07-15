// Deterministic portrait layer selection. All randomness comes from
// appearance.seed via mulberry32; the draw order below is a stable
// contract — append new draws at the end, never reorder.
import { moodExpression, type Appearance, type SkinTone } from "./character-schema";
import type { AgeStage } from "./age-stage";

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

// Hairstyles are curated per gender (the mod ships them as neutral `an-`,
// but bob/long/ponytails read feminine and bowlcut/mohawk/tuft masculine).
// Every name must exist in the manifest as both `a-<name>` and `c-<name>`.
export const HAIR_POOLS: Record<"f" | "m", string[]> = {
  f: ["afro", "bob", "curly", "long", "messy", "ponytails", "wavy"],
  m: ["afro", "bowlcut", "curly", "messy", "mohawk", "tuft", "wavy"],
};

// Garment size follows the mod's PawnBodyType matching (Requirements.cs):
// sizes are gender-specific for adults — female Thin/Standard wear m and
// Fat/Hulk wear l; male Thin/Standard/Hulk wear l and Fat/Hulk wear xl.
// Size s is child-only and unused here. Mapping our build tiers onto the
// mod's body types (thin/average/heavy/hulk):
const CLOTHES_SIZE_BY_GENDER_BUILD: Record<"f" | "m", Record<Appearance["build"], string>> = {
  f: { slim: "m", average: "m", sturdy: "l", robust: "l" },
  m: { slim: "l", average: "l", sturdy: "xl", robust: "xl" },
};

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function selectPortraitLayers(
  appearance: Appearance,
  mood: number,
  manifest: PortraitManifest,
  stage: AgeStage = "y",
): SelectedLayer[] {
  if (typeof appearance.seed !== "number" || !appearance.clothes) {
    throw new Error("portrait selection requires appearance.seed and appearance.clothes (legacy character?)");
  }
  const rand = mulberry32(appearance.seed);
  // Draw order contract (see header). Draw #1 is still consumed to keep the
  // sequence stable, but an explicit appearance.gender (chosen by the player
  // at creation) wins over the seed-derived one.
  const derivedGender = rand() < 0.5 ? "f" : "m";
  const gender = appearance.gender ?? derivedGender;
  const headShape = pick(rand, HEAD_SHAPES);
  // Same draw position as before; the pool is gender-specific but gender is
  // already fixed by draw #1, so determinism per character holds.
  const hairVariant = pick(rand, HAIR_POOLS[gender]);
  const hairColor = pick(rand, HAIR_COLORS);
  const hasBeard = rand() < 0.5;
  const beardVariant = pick(rand, Object.keys(manifest.layers.beard.variants));
  const faceBucketVariant = { low: 1 + Math.floor(rand() * 3), mid: 1 + Math.floor(rand() * 3), high: 1 + Math.floor(rand() * 3) };

  const skin = SKIN_COLOR[appearance.skinTone];
  const bucket = moodExpression(mood);

  // Art stages: faces/necks share child/teen/adult art (adult covers y/m/e);
  // hair has child/adult variants; heads are unique per stage.
  const artStage = stage === "c" ? "c" : stage === "t" ? "t" : "a";
  const hairStage = stage === "c" ? "c" : "a";

  const clothesSize =
    stage === "c" ? "s"
    : stage === "t"
      ? (gender === "m" && (appearance.build === "sturdy" || appearance.build === "robust") ? "l" : "m")
      : CLOTHES_SIZE_BY_GENDER_BUILD[gender][appearance.build];

  const wanted: Record<string, string | null> = {
    neck: stage === "c"
      ? `c-${gender}-child`
      : `${artStage}-${gender}-${NECK_BY_BUILD[appearance.build]}`,
    clothes: `${appearance.clothes}-${clothesSize}`,
    head: `${stage}-${gender}-${headShape}`,
    "face-inner": `${artStage}-${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    "face-outer": `${artStage}-${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    beard: artStage === "a" && gender === "m" && hasBeard ? beardVariant : null,
    hair: `${hairStage}-${hairVariant}`,
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
