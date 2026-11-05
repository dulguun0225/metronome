import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { nextPosition, PROCESSOR_NAME, type BeatSettings, type Level, type NoteReport, type Position } from "../../src/clickGenerator";

export { expect };

// A note the app's AudioWorklet reported: onset (audio clock seconds), position, and the pitch and peak
// gain of its click (before the master volume), both 0 for a muted note.
export type Note = NoteReport;
// A note that sounds.
export type Click = NoteReport;

declare global {
  interface Window {
    __audio: {
      // Every note the app received from its click worklet, and those of them that sound.
      notes: Note[];
      clicks: Click[];
      contexts: AudioContext[];
      // Gain nodes connected to the destination: one master output per run.
      outputs: GainNode[];
      // URLs of the AudioWorklet modules loaded.
      modules: string[];
      // Last gain value the app set on the latest output node, or null before the first run.
      outputGain(): number | null;
      currentTime(): number;
      // navigator.audioSession.type when each AudioContext was created.
      sessionTypes: (string | null)[];
    };
    __wakeLock: {
      log: string[];
      held(): number;
      // Releases held locks as the browser does when the page is hidden.
      releaseByBrowser(): void;
    };
    __swRegisterCalls: number;
  }
}

// Init script: records the app's Web Audio use and the notes its click worklet reports, as the app
// receives them. Runs in the page, so it must not use outer variables.
function recordAudio(processorName: string) {
  const notes: Note[] = [];
  const clicks: Click[] = [];
  const contexts: AudioContext[] = [];
  const outputs: GainNode[] = [];
  const modules: string[] = [];
  const sessionTypes: (string | null)[] = [];
  const lastValue = new WeakMap<AudioParam, number>();

  const param = AudioParam.prototype as unknown as Record<string, (...args: number[]) => AudioParam>;
  const value = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value")!;
  Object.defineProperty(AudioParam.prototype, "value", {
    ...value,
    set(this: AudioParam, v: number) {
      lastValue.set(this, v);
      value.set!.call(this, v);
    },
  });
  for (const name of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime"]) {
    const original = param[name];
    param[name] = function (this: AudioParam, v: number, ...rest: number[]) {
      lastValue.set(this, v);
      return original.call(this, v, ...rest);
    };
  }

  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    if (this instanceof GainNode && args[0] instanceof AudioDestinationNode) outputs.push(this);
    return connect.apply(this, args);
  } as AudioNode["connect"];

  const addModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function (this: AudioWorklet, url: string | URL, options?: WorkletOptions) {
    modules.push(String(url));
    return addModule.call(this, url, options);
  };

  // The messages of the app's click node are recorded when they reach the handler the app sets, so
  // nothing is recorded after the app removes it on stop.
  const onmessage = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage")!;
  const OriginalNode = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends OriginalNode {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      if (name !== processorName) return;
      const port = this.port;
      Object.defineProperty(port, "onmessage", {
        configurable: true,
        get: () => onmessage.get!.call(port),
        set: (handler: ((e: MessageEvent) => void) | null) => {
          onmessage.set!.call(
            port,
            handler &&
              ((e: MessageEvent<Note[]>) => {
                for (const note of e.data) {
                  notes.push(note);
                  if (note.peak > 0) clicks.push(note);
                }
                handler(e);
              }),
          );
        },
      });
    }
  };

  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) {
      super(options);
      contexts.push(this);
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      sessionTypes.push(session ? session.type : null);
    }
  };

  window.__audio = {
    notes,
    clicks,
    contexts,
    outputs,
    modules,
    sessionTypes,
    outputGain() {
      const output = outputs[outputs.length - 1];
      return output ? (lastValue.get(output.gain) ?? output.gain.value) : null;
    },
    currentTime() {
      return contexts[contexts.length - 1]?.currentTime ?? 0;
    },
  };

  window.__swRegisterCalls = 0;
  try {
    const container = navigator.serviceWorker;
    if (container) {
      const register = container.register.bind(container);
      container.register = (...args: Parameters<ServiceWorkerContainer["register"]>) => {
        window.__swRegisterCalls++;
        return register(...args);
      };
    }
  } catch {
    // No service worker support here.
  }
}

// Init script: replaces navigator.wakeLock with a stub that logs requests and releases.
function stubWakeLock() {
  const log: string[] = [];
  const held = new Set<EventTarget & { released: boolean }>();
  class Sentinel extends EventTarget {
    released = false;
    type = "screen";
    onrelease = null;
    release() {
      if (!this.released) {
        this.released = true;
        held.delete(this);
        log.push("release");
        this.dispatchEvent(new Event("release"));
      }
      return Promise.resolve();
    }
  }
  const wakeLock = {
    request(type: string) {
      log.push(`request:${type}`);
      const sentinel = new Sentinel();
      held.add(sentinel);
      return Promise.resolve(sentinel);
    },
  };
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: wakeLock });
  window.__wakeLock = {
    log,
    held: () => held.size,
    releaseByBrowser() {
      for (const sentinel of [...held]) {
        sentinel.released = true;
        held.delete(sentinel);
        log.push("browser-release");
        sentinel.dispatchEvent(new Event("release"));
      }
    },
  };
}

// Every page records audio and has the wake lock stub; uncaught page errors fail the test.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.addInitScript(recordAudio, PROCESSOR_NAME);
    await page.addInitScript(stubWakeLock);
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});

// Note interval at 120 BPM with 4 subdivisions per beat.
export const NOTE_120_4 = 60 / 120 / 4;
export const MAX_ACCENT_HZ = 1760;
export const ACCENT_HZ = 1320;
export const NORMAL_HZ = 880;
// Pitch and peak gain of the click of each level that sounds.
export const CLICK_OF = {
  normal: { hz: NORMAL_HZ, peak: 0.5 },
  accent: { hz: ACCENT_HZ, peak: 0.7 },
  maxAccent: { hz: MAX_ACCENT_HZ, peak: 1 },
} as const;
// Levels from lowest to highest (each slider's value), with the names the sliders state as their value text.
export const LEVEL_ORDER: Level[] = ["mute", "normal", "accent", "maxAccent"];
export const LEVEL_NAMES: Record<Level, string> = { mute: "mute", normal: "normal", accent: "accent", maxAccent: "max accent" };

export const playButton = (page: Page) => page.locator(".play-button");
export const tapButton = (page: Page) => page.getByRole("button", { name: "Tap tempo" });
export const tempoField = (page: Page) => page.locator("#tempo");
export const tempoSlider = (page: Page) => page.locator(".tempo-slider");
export const volumeSlider = (page: Page) => page.locator(".volume-slider");
export const countField = (page: Page) => page.locator("#beat-count");
export const beat = (page: Page, index: number) => page.locator(".beat").nth(index);
export const subSlider = (page: Page, beatIndex: number, sub: number) =>
  beat(page, beatIndex).getByRole("slider", { name: `Subdivision ${sub + 1}`, exact: true });
// Point at the middle of a level's band in a subdivision cell: max accent at the top, mute at the bottom.
export async function bandPosition(slider: Locator, level: Level) {
  const box = (await slider.boundingBox())!;
  const band = LEVEL_ORDER.length - 1 - LEVEL_ORDER.indexOf(level);
  return { x: box.width / 2, y: ((band + 0.5) * box.height) / LEVEL_ORDER.length };
}
export async function expectLevel(slider: Locator, level: Level) {
  await expect(slider).toHaveAttribute("aria-valuenow", String(LEVEL_ORDER.indexOf(level)));
  await expect(slider).toHaveAttribute("aria-valuetext", LEVEL_NAMES[level]);
}
// Sets a subdivision's level by clicking in that level's band of its cell.
export async function setSub(page: Page, beatIndex: number, sub: number, level: Level) {
  const slider = subSlider(page, beatIndex, sub);
  await slider.click({ position: await bandPosition(slider, level) });
  await expectLevel(slider, level);
}
export const subdivisionRadio = (page: Page, beatIndex: number, n: number) =>
  beat(page, beatIndex).locator(`input[type=radio][value="${n}"]`);

// Types a value into a number field and commits it, as leaving the field does.
export async function commit(field: Locator, value: number) {
  await field.fill(String(value));
  await field.blur();
}

// Sets a range input's value and fires its input event, as dragging does.
export async function slide(slider: Locator, value: number) {
  await slider.evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

export async function start(page: Page) {
  await expect(playButton(page)).toHaveText("Start");
  await playButton(page).click();
  await expect(playButton(page)).toHaveText("Stop");
}

export async function stop(page: Page) {
  await expect(playButton(page)).toHaveText("Stop");
  await playButton(page).click();
  await expect(playButton(page)).toHaveText("Start");
}

export function clicks(page: Page): Promise<Click[]> {
  return page.evaluate(() => window.__audio.clicks.slice());
}

export function notes(page: Page): Promise<Note[]> {
  return page.evaluate(() => window.__audio.notes.slice());
}

export function clearClicks(page: Page) {
  return page.evaluate(() => {
    window.__audio.clicks.length = 0;
    window.__audio.notes.length = 0;
  });
}

// Waits until at least `count` clicks are reported and returns them all.
export async function waitForClicks(page: Page, count: number, timeout = 15_000): Promise<Click[]> {
  await page.waitForFunction((n) => window.__audio.clicks.length >= n, count, { timeout });
  return clicks(page);
}

export function outputGain(page: Page) {
  return page.evaluate(() => window.__audio.outputGain());
}

// Index of each click on a grid of equal note intervals starting at the first click.
export function gridIndices(list: Click[], interval: number, origin = list[0].time) {
  return list.map((c) => Math.round((c.time - origin) / interval));
}

export interface ExpectedNote extends Position {
  time: number;
  hz: number;
  peak: number;
}

// The notes the metronome plays after `from` under fixed settings, with no subdivision muted.
export function expectedNotes(from: ExpectedNote, count: number, tempo: number, beatCount: number, beats: BeatSettings[]) {
  const out: ExpectedNote[] = [];
  let prev = from;
  for (let i = 0; i < count; i++) {
    const pos = nextPosition(prev, beatCount, beats);
    const time = prev.time + 60 / tempo / beats[prev.beat].subDivision;
    const level = beats[pos.beat].levels[pos.sub];
    if (level === "mute") throw new Error("expectedNotes does not handle muted subdivisions");
    prev = { ...pos, time, ...CLICK_OF[level] };
    out.push(prev);
  }
  return out;
}

// Beats with the given subdivisions and default levels, the first subdivision of each beat at max accent
// where `maxAccents` is true and at accent elsewhere.
export function beatsOf(subDivisions: number[], maxAccents: boolean[] = subDivisions.map((_, i) => i === 0)): BeatSettings[] {
  return subDivisions.map((subDivision, i) => ({
    subDivision,
    levels: Array.from({ length: 8 }, (_, sub): Level => (sub > 0 ? "normal" : maxAccents[i] ? "maxAccent" : "accent")),
  }));
}

// Summary of the visible settings: tempo, count, volume, per beat "subdivision:levels", with one digit
// per shown subdivision: 0 mute, 1 normal, 2 accent, 3 max accent, and the output delay: "automatic" or
// "manual:" and the slider value.
export function appState(page: Page) {
  return page.evaluate(() => ({
    tempo: (document.querySelector("#tempo") as HTMLInputElement).value,
    slider: (document.querySelector(".tempo-slider") as HTMLInputElement).value,
    count: (document.querySelector("#beat-count") as HTMLInputElement).value,
    volume: (document.querySelector(".volume-slider") as HTMLInputElement).value,
    beats: [...document.querySelectorAll(".beat")].map((b) => {
      const sub = (b.querySelector("input[type=radio]:checked") as HTMLInputElement).value;
      const digits = ["mute", "normal", "accent", "maxAccent"];
      const levels = [...b.querySelectorAll<HTMLElement>(".sub")].map((s) => digits.indexOf(s.dataset.level ?? "")).join("");
      return `${sub}:${levels}`;
    }),
    delay: (document.querySelector("input[name=output-delay-mode]:checked") as HTMLInputElement).value === "manual"
      ? `manual:${(document.querySelector(".delay-slider") as HTMLInputElement).value}`
      : "automatic",
  }));
}

export const DEFAULT_STATE = {
  tempo: "120",
  slider: "120",
  count: "4",
  volume: "80",
  beats: ["4:3111", "4:2111", "4:2111", "4:2111"],
  delay: "automatic",
};
