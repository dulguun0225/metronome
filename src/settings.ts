import { LEVELS, type BeatSettings, type Level } from "./metronome";

export const MIN_TEMPO = 20;
export const MAX_TEMPO = 300;
export const MAX_SUBDIVISION = 8;
export const DEFAULT_TEMPO = 120;
export const DEFAULT_BEAT_COUNT = 4;
// Master volume 0.8 with a max accent click gain of 1.0 gives the loudest click its former peak gain.
export const DEFAULT_VOLUME = 0.8;
// Largest manual output delay, in ms.
export const MAX_OUTPUT_DELAY = 500;

// Version of the stored format; stored data with any other version, including version 1
// (per-subdivision on/off flags and a per-beat accent), is ignored.
export const SCHEMA_VERSION = 2;

// How the beat highlight is delayed to match the sound: by the output delay the browser reports, or
// by a delay the user sets.
export type OutputDelayMode = "automatic" | "manual";

export interface SavedSettings {
  tempo: number;
  beatCount: number;
  // Master volume, 0 to 1.
  volume: number;
  // Settings for every beat ever shown, including those beyond beatCount; at least beatCount entries.
  beats: BeatSettings[];
  outputDelayMode: OutputDelayMode;
  // Manual output delay in ms, 0 to MAX_OUTPUT_DELAY; null until Manual is first chosen.
  manualOutputDelay: number | null;
}

export function defaultBeatSettings(index: number): BeatSettings {
  // One level per possible subdivision, sized to the largest choice so levels are kept when the subdivision changes.
  // The first subdivision of every beat is accented, that of the first beat the most.
  const first: Level = index === 0 ? "maxAccent" : "accent";
  return { subDivision: 4, levels: Array.from({ length: MAX_SUBDIVISION }, (_, i) => (i === 0 ? first : "normal")) };
}

// Default settings for beats `from` to `to - 1`.
export function defaultBeatsRange(from: number, to: number): BeatSettings[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => defaultBeatSettings(from + i));
}

export function defaultSettings(): SavedSettings {
  return {
    tempo: DEFAULT_TEMPO,
    beatCount: DEFAULT_BEAT_COUNT,
    volume: DEFAULT_VOLUME,
    beats: defaultBeatsRange(0, DEFAULT_BEAT_COUNT),
    outputDelayMode: "automatic",
    manualOutputDelay: null,
  };
}

export function clampTempo(n: number) {
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, n));
}

export function clampVolume(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function clampOutputDelay(n: number) {
  return Math.min(MAX_OUTPUT_DELAY, Math.max(0, n));
}

// Sites on one origin (e.g. GitHub Pages project sites) share localStorage, so the key
// includes the directory of the page's path.
export function storageKey(pathname: string) {
  const dir = pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";
  return `metronome:${dir}:settings`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is Level {
  return (LEVELS as readonly unknown[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A finite number rounded and clamped to [min, max]; null for anything else.
function readInteger(value: unknown, min: number, max: number): number | null {
  return isFiniteNumber(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;
}

function parseBeat(value: unknown, index: number): BeatSettings {
  const beat = defaultBeatSettings(index);
  if (!isRecord(value)) return beat;
  beat.subDivision = readInteger(value.subDivision, 1, MAX_SUBDIVISION) ?? beat.subDivision;
  const levels = value.levels;
  if (Array.isArray(levels) && levels.length === MAX_SUBDIVISION && levels.every(isLevel)) beat.levels = [...levels];
  return beat;
}

// Builds settings from stored data, using the default for every field that is missing or invalid
// and clamping numbers to their ranges.
export function parseSettings(data: unknown): SavedSettings {
  const settings = defaultSettings();
  if (!isRecord(data) || data.version !== SCHEMA_VERSION) return settings;
  settings.tempo = readInteger(data.tempo, MIN_TEMPO, MAX_TEMPO) ?? settings.tempo;
  if (isFiniteNumber(data.volume)) settings.volume = clampVolume(data.volume);
  const beats = Array.isArray(data.beats) ? data.beats.map(parseBeat) : [];
  // The app always stores at least beatCount beat entries, so a larger count is not data it wrote;
  // the bound also keeps a corrupt count from creating a huge number of beats.
  settings.beatCount = readInteger(data.beatCount, 1, Math.max(DEFAULT_BEAT_COUNT, beats.length)) ?? settings.beatCount;
  settings.beats = [...beats, ...defaultBeatsRange(beats.length, settings.beatCount)];
  // Data saved before the output delay setting existed has neither field and gets Automatic.
  settings.manualOutputDelay = readInteger(data.manualOutputDelay, 0, MAX_OUTPUT_DELAY);
  if (data.outputDelayMode === "manual") {
    settings.outputDelayMode = "manual";
    settings.manualOutputDelay ??= 0;
  }
  return settings;
}

// localStorage, or null where reading the property throws (storage blocked).
export function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage: Pick<Storage, "getItem"> | null, key: string): SavedSettings {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? defaultSettings() : parseSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(storage: Pick<Storage, "setItem"> | null, key: string, settings: SavedSettings) {
  const data = {
    version: SCHEMA_VERSION,
    tempo: settings.tempo,
    beatCount: settings.beatCount,
    volume: settings.volume,
    beats: settings.beats.map((b) => ({ subDivision: b.subDivision, levels: [...b.levels] })),
    outputDelayMode: settings.outputDelayMode,
    manualOutputDelay: settings.manualOutputDelay,
  };
  try {
    storage?.setItem(key, JSON.stringify(data));
  } catch {
    // Storage blocked or full: settings are not kept, the app works on.
  }
}
