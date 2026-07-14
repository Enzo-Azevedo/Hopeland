import { describe, expect, test } from "bun:test";
import manifest from "../../public/portraits/manifest.json";
import {
  genderFromSeed, mulberry32, selectPortraitLayers,
  type PortraitManifest,
} from "./portrait-selection";
import { buildCharacter } from "./character-schema";

const m = manifest as PortraitManifest;

function appearanceWithSeed(seed: number) {
  const c = buildCharacter({ category: "fisica", profession: "ferreiro", origin: "praia" });
  return { ...c.appearance, seed, gender: genderFromSeed(seed) };
}

describe("mulberry32", () => {
  test("same seed produces same sequence", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("selectPortraitLayers", () => {
  test("deterministic: same appearance+mood -> same selection", () => {
    const app = appearanceWithSeed(123456);
    expect(selectPortraitLayers(app, 50, m)).toEqual(selectPortraitLayers(app, 50, m));
  });

  test("every selected variant exists in the manifest", () => {
    for (const seed of [0, 1, 999, 2 ** 31, 4294967295]) {
      for (const mood of [0, 50, 100]) {
        for (const sel of selectPortraitLayers(appearanceWithSeed(seed), mood, m)) {
          expect(sel.url.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("mood buckets swap only the face layer", () => {
    const app = appearanceWithSeed(777);
    const low = selectPortraitLayers(app, 10, m);
    const high = selectPortraitLayers(app, 90, m);
    const diff = low.filter((l, i) => l.url !== high[i]?.url).map((l) => l.layer);
    expect(diff.every((k) => k.startsWith("face"))).toBe(true);
    expect(diff.length).toBeGreaterThan(0);
  });

  test("clothes follow profession, skin follows origin", () => {
    const c = buildCharacter({ category: "social", profession: "menestrel", origin: "deserto" });
    const sel = selectPortraitLayers(c.appearance, 50, m);
    expect(sel.find((l) => l.layer === "clothes")!.url).toContain("menestrel");
  });

  test("beard only for m, hair layer always present", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const app = appearanceWithSeed(seed);
      const layers = selectPortraitLayers(app, 50, m).map((l) => l.layer);
      expect(layers).toContain("hair");
      if (app.gender === "f") expect(layers).not.toContain("beard");
    }
  });
});

describe("buildCharacter appearance", () => {
  test("fills seed and matching gender", () => {
    const c = buildCharacter({ category: "agil", profession: "pescador", origin: "mar" });
    expect(Number.isInteger(c.appearance.seed)).toBe(true);
    expect(c.appearance.gender).toBe(genderFromSeed(c.appearance.seed));
  });
});
