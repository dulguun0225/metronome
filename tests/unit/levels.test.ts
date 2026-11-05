import { describe, expect, test } from "vitest";
import { LEVELS, levelAtPosition } from "../../src/metronome";

describe("levelAtPosition", () => {
  test("lists the levels from lowest to highest", () => {
    expect(LEVELS).toEqual(["mute", "normal", "accent", "maxAccent"]);
  });

  test("maps four equal bands from max accent at the top to mute at the bottom", () => {
    expect(levelAtPosition(5, 48)).toBe("maxAccent");
    expect(levelAtPosition(18, 48)).toBe("accent");
    expect(levelAtPosition(30, 48)).toBe("normal");
    expect(levelAtPosition(42, 48)).toBe("mute");
  });

  test("a band's top edge belongs to that band", () => {
    expect(levelAtPosition(0, 48)).toBe("maxAccent");
    expect(levelAtPosition(11.99, 48)).toBe("maxAccent");
    expect(levelAtPosition(12, 48)).toBe("accent");
    expect(levelAtPosition(23.99, 48)).toBe("accent");
    expect(levelAtPosition(24, 48)).toBe("normal");
    expect(levelAtPosition(35.99, 48)).toBe("normal");
    expect(levelAtPosition(36, 48)).toBe("mute");
    expect(levelAtPosition(47.99, 48)).toBe("mute");
    expect(levelAtPosition(48, 48)).toBe("mute");
  });

  test("clamps positions above the cell to max accent and below it to mute", () => {
    expect(levelAtPosition(-0.01, 48)).toBe("maxAccent");
    expect(levelAtPosition(-500, 48)).toBe("maxAccent");
    expect(levelAtPosition(48.01, 48)).toBe("mute");
    expect(levelAtPosition(500, 48)).toBe("mute");
  });

  test("gives mute for a cell without height or an invalid position", () => {
    expect(levelAtPosition(10, 0)).toBe("mute");
    expect(levelAtPosition(Number.NaN, 48)).toBe("mute");
  });
});
