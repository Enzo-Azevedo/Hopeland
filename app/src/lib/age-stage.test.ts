import { describe, expect, test } from "bun:test";
import { ageStage, isDeadByAge, stageLabel, DEATH_SECONDS } from "./age-stage";

const H = 3600;

describe("ageStage", () => {
  test("boundaries", () => {
    expect(ageStage(0)).toBe("c");
    expect(ageStage(8 * H - 1)).toBe("c");
    expect(ageStage(8 * H)).toBe("t");
    expect(ageStage(24 * H - 1)).toBe("t");
    expect(ageStage(24 * H)).toBe("y");
    expect(ageStage(84 * H - 1)).toBe("y");
    expect(ageStage(84 * H)).toBe("m");
    expect(ageStage(234 * H - 1)).toBe("m");
    expect(ageStage(234 * H)).toBe("e");
    expect(ageStage(284 * H - 1)).toBe("e");
    expect(ageStage(284 * H)).toBe("e"); // stage caps at elder even past death
  });

  test("death threshold", () => {
    expect(DEATH_SECONDS).toBe(284 * H);
    expect(isDeadByAge(DEATH_SECONDS - 1)).toBe(false);
    expect(isDeadByAge(DEATH_SECONDS)).toBe(true);
  });

  test("labels are PT-BR", () => {
    expect(stageLabel("c")).toBe("Criança");
    expect(stageLabel("t")).toBe("Adolescente");
    expect(stageLabel("y")).toBe("Jovem adulto");
    expect(stageLabel("m")).toBe("Meia-idade");
    expect(stageLabel("e")).toBe("Idoso");
  });
});
