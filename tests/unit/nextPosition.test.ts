import { describe, expect, test } from "vitest";
import { nextPosition, type BeatSettings, type Level, type Position } from "../../src/metronome";

const beat = (subDivision: number, levels: Level[] = Array<Level>(8).fill("normal")): BeatSettings => ({
  subDivision,
  levels,
});

describe("nextPosition", () => {
  test("progresses through subdivisions and beats and wraps at the bar end", () => {
    const beats = [beat(2), beat(3), beat(1)];
    const seq: Position[] = [{ beat: 0, sub: 0 }];
    for (let i = 0; i < 7; i++) seq.push(nextPosition(seq[seq.length - 1], 3, beats));
    expect(seq).toEqual([
      { beat: 0, sub: 0 },
      { beat: 0, sub: 1 },
      { beat: 1, sub: 0 },
      { beat: 1, sub: 1 },
      { beat: 1, sub: 2 },
      { beat: 2, sub: 0 },
      { beat: 0, sub: 0 },
      { beat: 0, sub: 1 },
    ]);
  });

  test("wraps from the last subdivision of the last beat", () => {
    expect(nextPosition({ beat: 3, sub: 3 }, 4, [beat(4), beat(4), beat(4), beat(4)])).toEqual({ beat: 0, sub: 0 });
  });

  test("one beat with one subdivision stays at the start", () => {
    expect(nextPosition({ beat: 0, sub: 0 }, 1, [beat(1)])).toEqual({ beat: 0, sub: 0 });
  });

  test("beat count lowered below the current beat, mid-beat, wraps", () => {
    expect(nextPosition({ beat: 3, sub: 1 }, 2, [beat(4), beat(4), beat(4), beat(4)])).toEqual({ beat: 0, sub: 0 });
  });

  test("beat count lowered to equal the current beat wraps", () => {
    expect(nextPosition({ beat: 2, sub: 0 }, 2, [beat(4), beat(4), beat(4)])).toEqual({ beat: 0, sub: 0 });
  });

  test("subdivision lowered below the current subdivision moves to the next beat", () => {
    expect(nextPosition({ beat: 1, sub: 5 }, 4, [beat(4), beat(3), beat(4), beat(4)])).toEqual({ beat: 2, sub: 0 });
  });

  test("subdivision lowered below the current subdivision on the last beat wraps", () => {
    expect(nextPosition({ beat: 3, sub: 5 }, 4, [beat(4), beat(4), beat(4), beat(2)])).toEqual({ beat: 0, sub: 0 });
  });

  test("subdivision raised mid-beat continues within the beat", () => {
    expect(nextPosition({ beat: 0, sub: 3 }, 2, [beat(8), beat(4)])).toEqual({ beat: 0, sub: 4 });
  });

  test("a muted subdivision is still a position", () => {
    const levels: Level[] = ["normal", "mute", "normal", "normal", "normal", "normal", "normal", "normal"];
    expect(nextPosition({ beat: 0, sub: 0 }, 1, [beat(2, levels)])).toEqual({ beat: 0, sub: 1 });
  });
});
