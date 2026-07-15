import { describe, expect, test } from "bun:test";
import manifest from "../../public/portraits/manifest.json";
import {
  genderFromSeed, mulberry32, selectPortraitLayers, HAIR_POOLS,
  type PortraitManifest,
} from "./portrait-selection";
import { buildCharacter } from "./character-schema";
import type { AgeStage } from "./age-stage";

const m = manifest as PortraitManifest;
const STAGES: AgeStage[] = ["c", "t", "y", "m", "e"];

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
  test("deterministic and defaults to young adult", () => {
    const app = appearanceWithSeed(123456);
    expect(selectPortraitLayers(app, 50, m)).toEqual(selectPortraitLayers(app, 50, m, "y"));
  });

  test("exhaustive: every stage x gender x build x mood resolves", () => {
    const builds = ["slim", "average", "sturdy", "robust"] as const;
    for (const stage of STAGES) {
      for (const gender of ["f", "m"] as const) {
        for (const build of builds) {
          for (const mood of [0, 50, 100]) {
            const app = { ...appearanceWithSeed(97, gender), build };
            const sel = selectPortraitLayers(app, mood, m, stage);
            expect(sel.length).toBeGreaterThanOrEqual(5);
          }
        }
      }
    }
  });

  test("every hair pool name exists in the manifest for both art stages", () => {
    const variants = Object.keys(m.layers.hair.variants);
    for (const gender of ["f", "m"] as const) {
      for (const name of HAIR_POOLS[gender]) {
        expect(variants).toContain(`a-${name}`);
        expect(variants).toContain(`c-${name}`);
      }
    }
  });

  test("hair pools are gender-specific: no cross-gender styles", () => {
    const feminineOnly = HAIR_POOLS.f.filter((n) => !HAIR_POOLS.m.includes(n));
    const masculineOnly = HAIR_POOLS.m.filter((n) => !HAIR_POOLS.f.includes(n));
    expect(feminineOnly.length).toBeGreaterThan(0);
    expect(masculineOnly.length).toBeGreaterThan(0);
    for (let seed = 0; seed < 40; seed++) {
      const male = selectPortraitLayers(appearanceWithSeed(seed, "m"), 50, m, "y")
        .find((l) => l.layer === "hair")!.url;
      for (const f of feminineOnly) expect(male).not.toContain(`-${f}.webp`);
      const female = selectPortraitLayers(appearanceWithSeed(seed, "f"), 50, m, "y")
        .find((l) => l.layer === "hair")!.url;
      for (const mo of masculineOnly) expect(female).not.toContain(`-${mo}.webp`);
    }
  });

  test("identity persists across stages: same hair name and face trait slot", () => {
    const app = appearanceWithSeed(2024, "m");
    const variantOf = (stage: AgeStage, layer: string) =>
      selectPortraitLayers(app, 50, m, stage).find((l) => l.layer === layer)?.url ?? "";
    const childHair = variantOf("c", "hair").split("/").pop()!;
    const adultHair = variantOf("e", "hair").split("/").pop()!;
    expect(childHair.replace(/^c-/, "")).toBe(adultHair.replace(/^a-/, ""));
    const childFace = variantOf("c", "face-inner").split("/").pop()!;
    const elderFace = variantOf("e", "face-inner").split("/").pop()!;
    expect(childFace.replace(/^c-/, "")).toBe(elderFace.replace(/^a-/, ""));
    expect(variantOf("m", "head").split("/").pop()!.startsWith("m-m-")).toBe(true);
  });

  test("children: no beard, single neck, size s clothes", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const app = { ...appearanceWithSeed(seed, "m"), build: "robust" as const };
      const sel = selectPortraitLayers(app, 50, m, "c");
      expect(sel.map((l) => l.layer)).not.toContain("beard");
      expect(sel.find((l) => l.layer === "neck")!.url).toContain("c-m-child");
      expect(sel.find((l) => l.layer === "clothes")!.url).toContain("-s.webp");
    }
  });

  test("teens: neck has build tiers, clothes m (or l for heavy male)", () => {
    const slim = { ...appearanceWithSeed(7, "m"), build: "slim" as const };
    expect(selectPortraitLayers(slim, 50, m, "t").find((l) => l.layer === "neck")!.url)
      .toContain("t-m-thin");
    expect(selectPortraitLayers(slim, 50, m, "t").find((l) => l.layer === "clothes")!.url)
      .toContain("-m.webp");
    const heavy = { ...appearanceWithSeed(7, "m"), build: "robust" as const };
    expect(selectPortraitLayers(heavy, 50, m, "t").find((l) => l.layer === "clothes")!.url)
      .toContain("-l.webp");
  });

  test("adult clothes mapping unchanged by stage y/m/e", () => {
    const app = { ...appearanceWithSeed(11, "m"), build: "robust" as const, clothes: "estivador" as const };
    for (const stage of ["y", "m", "e"] as const) {
      expect(selectPortraitLayers(app, 50, m, stage).find((l) => l.layer === "clothes")!.url)
        .toContain("estivador-xl");
    }
  });

  test("mood buckets swap only face layers at any stage", () => {
    for (const stage of STAGES) {
      const app = appearanceWithSeed(777);
      const low = selectPortraitLayers(app, 10, m, stage);
      const high = selectPortraitLayers(app, 90, m, stage);
      const diff = low.filter((l, i) => l.url !== high[i]?.url).map((l) => l.layer);
      expect(diff.every((k) => k.startsWith("face"))).toBe(true);
      expect(diff.length).toBeGreaterThan(0);
    }
  });
});

describe("buildCharacter", () => {
  test("fills seed, stores explicit gender and validated name", () => {
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
