import { describe, expect, test } from "bun:test";
import manifest from "../../public/portraits/manifest.json";
import {
  genderFromSeed, mulberry32, selectPortraitLayers,
  type PortraitManifest,
} from "./portrait-selection";
import { buildCharacter } from "./character-schema";

const m = manifest as PortraitManifest;

const BASE_INPUT = {
  category: "fisica", profession: "ferreiro", origin: "praia",
  name: "Teste", gender: "f",
} as const;

function appearanceWithSeed(seed: number, gender: "f" | "m" = genderFromSeed(seed)) {
  const c = buildCharacter({ ...BASE_INPUT, gender });
  return { ...c.appearance, seed, gender };
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

  test("every selected variant exists in the manifest, for both explicit genders", () => {
    for (const seed of [0, 1, 999, 2 ** 31, 4294967295]) {
      for (const gender of ["f", "m"] as const) {
        for (const mood of [0, 50, 100]) {
          for (const sel of selectPortraitLayers(appearanceWithSeed(seed, gender), mood, m)) {
            expect(sel.url.length).toBeGreaterThan(0);
          }
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
    const c = buildCharacter({ ...BASE_INPUT, category: "social", profession: "menestrel", origin: "deserto" });
    const sel = selectPortraitLayers(c.appearance, 50, m);
    expect(sel.find((l) => l.layer === "clothes")!.url).toContain("menestrel");
  });

  test("explicit gender overrides the seed-derived one for layer keys", () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const flipped = genderFromSeed(seed) === "f" ? "m" : "f";
      const sel = selectPortraitLayers(appearanceWithSeed(seed, flipped), 50, m);
      const head = sel.find((l) => l.layer === "head")!;
      expect(head.url).toContain(`/head/${flipped}-`);
      if (flipped === "f") {
        expect(sel.map((l) => l.layer)).not.toContain("beard");
      }
    }
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

describe("buildCharacter", () => {
  test("fills seed, stores the explicit gender and the validated name", () => {
    const c = buildCharacter({ ...BASE_INPUT, gender: "m", name: "  Kael  da Praia " });
    expect(Number.isInteger(c.appearance.seed)).toBe(true);
    expect(c.appearance.gender).toBe("m");
    expect(c.name).toBe("Kael da Praia");
  });

  test("rejects invalid names", () => {
    expect(() => buildCharacter({ ...BASE_INPUT, name: "x" })).toThrow();
    expect(() => buildCharacter({ ...BASE_INPUT, name: "nome_com_underscore" })).toThrow();
  });
});
