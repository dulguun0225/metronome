import { describe, expect, test } from "vitest";
import { LEVELS, nextLevel } from "../../src/metronome";

describe("nextLevel", () => {
  test("steps mute, normal, accent, max accent and back to mute", () => {
    expect(LEVELS).toEqual(["mute", "normal", "accent", "maxAccent"]);
    expect(nextLevel("mute")).toBe("normal");
    expect(nextLevel("normal")).toBe("accent");
    expect(nextLevel("accent")).toBe("maxAccent");
    expect(nextLevel("maxAccent")).toBe("mute");
  });
});
