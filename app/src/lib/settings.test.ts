import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS, getSettings, loadSettings, resetSettingsForTests,
  saveSettings, subscribe,
} from "./settings";

function fakeStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

describe("settings", () => {
  test("defaults when storage is empty or corrupted", () => {
    resetSettingsForTests();
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
    resetSettingsForTests();
    expect(
      loadSettings(fakeStorage({ "hopeland-settings-v1": "{not json" })),
    ).toEqual(DEFAULT_SETTINGS);
  });

  test("merges partial/unknown keys over defaults", () => {
    resetSettingsForTests();
    const s = loadSettings(
      fakeStorage({
        "hopeland-settings-v1": JSON.stringify({ showElevation: true, legacy: 1 }),
      }),
    );
    expect(s).toEqual({ ...DEFAULT_SETTINGS, showElevation: true });
  });

  test("saveSettings persists round-trip and notifies subscribers", () => {
    resetSettingsForTests();
    const storage = fakeStorage();
    loadSettings(storage);
    const seen: boolean[] = [];
    const off = subscribe((s) => seen.push(s.alwaysAnimate));
    saveSettings({ alwaysAnimate: true }, storage);
    expect(seen).toEqual([true]);
    expect(JSON.parse(storage.dump()["hopeland-settings-v1"]!)).toEqual({
      ...DEFAULT_SETTINGS,
      alwaysAnimate: true,
    });
    off();
    saveSettings({ alwaysAnimate: false }, storage);
    expect(seen).toEqual([true]); // unsubscribed
  });

  test("getSettings returns isolated snapshots", () => {
    resetSettingsForTests();
    loadSettings(fakeStorage());
    const a = getSettings();
    a.showFlowArrows = true;
    expect(getSettings().showFlowArrows).toBe(false);
  });
});
