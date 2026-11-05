import { describe, expect, test } from "vitest";
import {
  DEFAULT_BEAT_COUNT,
  DEFAULT_TEMPO,
  DEFAULT_VOLUME,
  defaultBeatSettings,
  defaultSettings,
  loadSettings,
  parseSettings,
  saveSettings,
  SCHEMA_VERSION,
  storageKey,
  type SavedSettings,
} from "../../src/settings";
import type { Level } from "../../src/metronome";

const KEY = "metronome:/:settings";
// Levels of the first subdivision then of the other seven.
const levels = (first: Level, rest: Level = "normal"): Level[] => [first, ...Array<Level>(7).fill(rest)];

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const throwing = {
  getItem(): string | null {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem() {
    throw new DOMException("full", "QuotaExceededError");
  },
};

// Stored data with valid fields, to be changed per test.
function stored(fields: Record<string, unknown> = {}) {
  return {
    version: SCHEMA_VERSION,
    tempo: 90,
    beatCount: 3,
    volume: 0.5,
    beats: [
      { subDivision: 3, levels: ["accent", "mute", "normal", "maxAccent", "normal", "normal", "normal", "normal"] },
      { subDivision: 2, levels: levels("maxAccent") },
      { subDivision: 1, levels: levels("mute", "accent") },
    ],
    ...fields,
  };
}

describe("defaults", () => {
  test("default settings", () => {
    expect(defaultSettings()).toEqual({
      tempo: 120,
      beatCount: 4,
      volume: 0.8,
      beats: [
        { subDivision: 4, levels: levels("maxAccent") },
        { subDivision: 4, levels: levels("accent") },
        { subDivision: 4, levels: levels("accent") },
        { subDivision: 4, levels: levels("accent") },
      ],
    });
  });

  test("default settings for a beat beyond the default count", () => {
    expect(defaultBeatSettings(6)).toEqual({ subDivision: 4, levels: levels("accent") });
  });
});

describe("storageKey", () => {
  test.each([
    ["/", "metronome:/:settings"],
    ["/index.html", "metronome:/:settings"],
    ["/metronome/", "metronome:/metronome/:settings"],
    ["/metronome/index.html", "metronome:/metronome/:settings"],
    ["/a/b", "metronome:/a/:settings"],
    ["", "metronome:/:settings"],
  ])("%s -> %s", (pathname, key) => {
    expect(storageKey(pathname)).toBe(key);
  });
});

describe("parseSettings", () => {
  test("valid data is kept", () => {
    const data = stored();
    expect(parseSettings(data)).toEqual({
      tempo: data.tempo,
      beatCount: data.beatCount,
      volume: data.volume,
      beats: data.beats,
    });
  });

  test.each([null, undefined, 42, "text", [], true])("non-object %j gives defaults", (data) => {
    expect(parseSettings(data)).toEqual(defaultSettings());
  });

  test.each([undefined, 0, 1, 3, "2"])("version %j gives defaults", (version) => {
    expect(parseSettings(stored({ version }))).toEqual(defaultSettings());
  });

  test.each([
    [500, 300],
    [19, 20],
    [-5, 20],
    [120.6, 121],
    [300, 300],
    [20, 20],
  ])("tempo %j is clamped to %j", (tempo, expected) => {
    expect(parseSettings(stored({ tempo })).tempo).toBe(expected);
  });

  test.each([undefined, null, "120", NaN, Infinity, {}])("tempo %j falls back to the default", (tempo) => {
    expect(parseSettings(stored({ tempo })).tempo).toBe(DEFAULT_TEMPO);
  });

  test.each([
    [0, 1],
    [-3, 1],
    [2.4, 2],
  ])("beat count %j is clamped to %j", (beatCount, expected) => {
    expect(parseSettings(stored({ beatCount })).beatCount).toBe(expected);
  });

  test.each([undefined, "3", null])("beat count %j falls back to the default", (beatCount) => {
    const s = parseSettings(stored({ beatCount }));
    expect(s.beatCount).toBe(DEFAULT_BEAT_COUNT);
    expect(s.beats).toHaveLength(DEFAULT_BEAT_COUNT);
  });

  test("beat count is limited to the stored beat entries, at least the default count", () => {
    expect(parseSettings(stored({ beatCount: 1e9 })).beatCount).toBe(DEFAULT_BEAT_COUNT);
    const beats = Array.from({ length: 7 }, (_, i) => defaultBeatSettings(i));
    expect(parseSettings(stored({ beatCount: 1e9, beats })).beatCount).toBe(7);
  });

  test("missing beat entries up to the count get defaults", () => {
    const s = parseSettings(stored({ beatCount: 4, beats: [{ subDivision: 2, levels: levels("accent") }] }));
    expect(s.beatCount).toBe(4);
    expect(s.beats).toEqual([
      { subDivision: 2, levels: levels("accent") },
      defaultBeatSettings(1),
      defaultBeatSettings(2),
      defaultBeatSettings(3),
    ]);
  });

  test("beats that are not an array give default beats", () => {
    const s = parseSettings(stored({ beats: "x", beatCount: 2 }));
    expect(s.beatCount).toBe(2);
    expect(s.beats).toEqual([defaultBeatSettings(0), defaultBeatSettings(1)]);
  });

  test("beat entries beyond the count are kept", () => {
    const beats = stored().beats;
    const s = parseSettings(stored({ beatCount: 1 }));
    expect(s.beatCount).toBe(1);
    expect(s.beats).toEqual(beats);
  });

  test("a beat entry that is not an object gets the defaults for its index", () => {
    const s = parseSettings(stored({ beats: [null, 5, "x"] }));
    expect(s.beats).toEqual([defaultBeatSettings(0), defaultBeatSettings(1), defaultBeatSettings(2)]);
  });

  test.each([
    [0, 1],
    [9, 8],
    [2.6, 3],
    [8, 8],
    [1, 1],
  ])("subdivision %j is clamped to %j", (subDivision, expected) => {
    const s = parseSettings(stored({ beats: [{ subDivision, levels: levels("maxAccent") }] }));
    expect(s.beats[0].subDivision).toBe(expected);
  });

  test.each([undefined, "3", null, NaN])("subdivision %j falls back to the default", (subDivision) => {
    const s = parseSettings(stored({ beats: [{ subDivision, levels: levels("maxAccent") }] }));
    expect(s.beats[0].subDivision).toBe(4);
  });

  test.each([
    ["too short", ["mute", "normal", "accent"]],
    ["too long", Array(9).fill("normal")],
    ["an unknown name", ["normal", "normal", "loud", "normal", "normal", "normal", "normal", "normal"]],
    ["one null", ["normal", "normal", null, "normal", "normal", "normal", "normal", "normal"]],
    ["version 1 flags", Array(8).fill(true)],
    ["indices", [0, 1, 2, 3, 0, 1, 2, 3]],
    ["not an array", "normal"],
    ["missing", undefined],
  ])("levels %s fall back to the defaults for the beat's index", (_, invalid) => {
    const s = parseSettings(stored({ beats: [{ subDivision: 2, levels: invalid }, { subDivision: 3, levels: invalid }] }));
    expect(s.beats.slice(0, 2)).toEqual([
      { subDivision: 2, levels: levels("maxAccent") },
      { subDivision: 3, levels: levels("accent") },
    ]);
  });

  test("valid levels are copied", () => {
    const valid: Level[] = ["mute", "normal", "accent", "maxAccent", "maxAccent", "accent", "normal", "mute"];
    const s = parseSettings(stored({ beats: [{ subDivision: 8, levels: valid }] }));
    expect(s.beats[0].levels).toEqual(valid);
    expect(s.beats[0].levels).not.toBe(valid);
  });

  test("version 1 data, with on/off flags and accents, gives defaults", () => {
    const data = {
      version: 1,
      tempo: 90,
      beatCount: 3,
      volume: 0.5,
      beats: [
        { subDivision: 3, enabled: [true, false, true, true, true, true, true, true], accent: false },
        { subDivision: 2, enabled: Array(8).fill(true), accent: true },
        { subDivision: 1, enabled: Array(8).fill(false), accent: false },
      ],
    };
    expect(parseSettings(data)).toEqual(defaultSettings());
    const storage = new MemoryStorage();
    storage.setItem(KEY, JSON.stringify(data));
    expect(loadSettings(storage, KEY)).toEqual(defaultSettings());
  });

  test.each([
    [-1, 0],
    [2, 1],
    [0, 0],
    [1, 1],
    [0.25, 0.25],
  ])("volume %j is clamped to %j", (volume, expected) => {
    expect(parseSettings(stored({ volume })).volume).toBe(expected);
  });

  test.each([undefined, "0.5", null, NaN])("volume %j falls back to the default", (volume) => {
    expect(parseSettings(stored({ volume })).volume).toBe(DEFAULT_VOLUME);
  });

  test("bad fields fall back one by one", () => {
    const s = parseSettings(stored({ tempo: "fast", volume: 0.3 }));
    expect(s.tempo).toBe(DEFAULT_TEMPO);
    expect(s.volume).toBe(0.3);
    expect(s.beatCount).toBe(3);
  });
});

describe("loadSettings and saveSettings", () => {
  const custom: SavedSettings = {
    tempo: 87,
    beatCount: 2,
    volume: 0.35,
    beats: [
      { subDivision: 3, levels: ["accent", "mute", "normal", "normal", "normal", "normal", "normal", "normal"] },
      { subDivision: 8, levels: ["maxAccent", "normal", "accent", "maxAccent", "normal", "mute", "normal", "normal"] },
      { subDivision: 6, levels: ["mute", "normal", "normal", "mute", "normal", "normal", "normal", "normal"] },
    ],
  };

  test("saved settings load back unchanged, including beats beyond the count", () => {
    const storage = new MemoryStorage();
    saveSettings(storage, KEY, custom);
    expect(loadSettings(storage, KEY)).toEqual(custom);
  });

  test("the stored data has the schema version", () => {
    const storage = new MemoryStorage();
    saveSettings(storage, KEY, custom);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ version: SCHEMA_VERSION, ...custom });
  });

  test("keys are separate", () => {
    const storage = new MemoryStorage();
    saveSettings(storage, storageKey("/a/"), custom);
    expect(loadSettings(storage, storageKey("/b/"))).toEqual(defaultSettings());
  });

  test("nothing stored gives defaults", () => {
    expect(loadSettings(new MemoryStorage(), KEY)).toEqual(defaultSettings());
  });

  test("invalid JSON gives defaults", () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, "{not json");
    expect(loadSettings(storage, KEY)).toEqual(defaultSettings());
  });

  test("storage that throws gives defaults and saving does not throw", () => {
    expect(loadSettings(throwing, KEY)).toEqual(defaultSettings());
    expect(() => saveSettings(throwing, KEY, custom)).not.toThrow();
  });

  test("no storage gives defaults and saving does nothing", () => {
    expect(loadSettings(null, KEY)).toEqual(defaultSettings());
    expect(() => saveSettings(null, KEY, custom)).not.toThrow();
  });
});
