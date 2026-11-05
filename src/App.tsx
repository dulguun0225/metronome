import { batch, createEffect, createSignal, Index, on, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { createStore } from "solid-js/store";
import Beat from "./Beat";
import { Metronome, type BeatSettings, type Settings } from "./metronome";
import {
  clampOutputDelay,
  clampTempo,
  clampVolume,
  defaultBeatsRange,
  defaultSettings,
  getLocalStorage,
  loadSettings,
  MAX_OUTPUT_DELAY,
  MAX_TEMPO,
  MIN_TEMPO,
  saveSettings,
  storageKey,
  type OutputDelayMode,
} from "./settings";
import { tapTempo } from "./tapTempo";
import { ScreenWakeLock } from "./wakeLock";

// How often the output delay the browser reports is read for display, in ms.
const REPORTED_DELAY_INTERVAL_MS = 500;

// Input types that are not typed into; key presses on them are not text entry.
const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "color", "file", "image"]);

// Conventional Italian tempo marking for a tempo in BPM.
function tempoMarking(bpm: number) {
  if (bpm < 40) return "Grave";
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 156) return "Allegro";
  if (bpm < 176) return "Vivace";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

function isTextField(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type);
}

function isInputOfType(el: Element | null, ...types: string[]) {
  return el instanceof HTMLInputElement && types.includes(el.type);
}

// A subdivision level slider of a Beat; arrow keys on it change its level.
function isLevelSlider(el: Element | null) {
  return el instanceof HTMLElement && el.classList.contains("sub");
}

// Reads an integer from a number input, clamps it to [min, max] and stores it.
// An empty or invalid entry keeps the previous value.
function commitInteger(
  input: HTMLInputElement,
  get: Accessor<number>,
  set: (value: number) => void,
  min: number,
  max = Infinity,
) {
  const n = Math.floor(input.valueAsNumber);
  if (!Number.isNaN(n)) set(Math.min(max, Math.max(min, n)));
  // Rewrite the field: an invalid or clamped entry leaves the signal unchanged, so Solid would not update it.
  input.value = String(get());
}

export default function App() {
  const storage = getLocalStorage();
  const settingsKey = storageKey(location.pathname);
  const saved = loadSettings(storage, settingsKey);
  const [beatCount, setBeatCount] = createSignal(saved.beatCount);
  const [tempo, setTempo] = createSignal(saved.tempo);
  const [volume, setVolume] = createSignal(saved.volume);
  const [playing, setPlaying] = createSignal(false);
  // Settings for every beat ever shown, not only the first beatCount, so they are kept when the count is lowered then raised.
  const [beats, setBeats] = createStore<BeatSettings[]>(saved.beats);
  const [activeBeat, setActiveBeat] = createSignal<number | null>(null);
  const [activeSub, setActiveSub] = createSignal<number | null>(null);
  const [outputDelayMode, setOutputDelayMode] = createSignal<OutputDelayMode>(saved.outputDelayMode);
  const [manualOutputDelay, setManualOutputDelay] = createSignal<number | null>(saved.manualOutputDelay);
  // Output delay the browser reports, in whole ms, or null when it reports none.
  const [reportedDelay, setReportedDelay] = createSignal<number | null>(null);

  // Plain copies of the playback settings, as the metronome sends them to the audio thread.
  const playbackSettings = (): Settings => ({
    tempo: tempo(),
    beatCount: beatCount(),
    beats: beats.map((b) => ({ subDivision: b.subDivision, levels: [...b.levels] })),
  });
  const metronome = new Metronome(playbackSettings(), (pos) =>
    batch(() => {
      setActiveBeat(pos?.beat ?? null);
      setActiveSub(pos?.sub ?? null);
    }),
  );
  onCleanup(() => metronome.dispose());
  createEffect(() => metronome.setVolume(volume()));
  // Settings reach the audio thread when they change, and apply from the next note.
  createEffect(() => metronome.setSettings(playbackSettings()));
  createEffect(() => metronome.setOutputDelay(outputDelayMode() === "manual" ? (manualOutputDelay() ?? 0) / 1000 : null));

  const readReportedDelay = () => {
    const seconds = metronome.reportedOutputDelay();
    setReportedDelay(seconds === null ? null : Math.round(seconds * 1000));
  };
  const reportedDelayTimer = setInterval(readReportedDelay, REPORTED_DELAY_INTERVAL_MS);
  onCleanup(() => clearInterval(reportedDelayTimer));

  // The first switch to Manual starts the slider at the delay the browser reports.
  function changeOutputDelayMode(mode: OutputDelayMode) {
    batch(() => {
      if (mode === "manual" && manualOutputDelay() === null) {
        const seconds = metronome.reportedOutputDelay();
        setManualOutputDelay(clampOutputDelay(seconds === null ? 0 : Math.round(seconds * 1000)));
      }
      setOutputDelayMode(mode);
    });
  }

  // Saves the settings whenever one changes. Not on load, so stored data of another schema version stays until then.
  createEffect(
    on(
      () => ({
        tempo: tempo(),
        beatCount: beatCount(),
        volume: volume(),
        beats: beats.map((b) => ({ subDivision: b.subDivision, levels: [...b.levels] })),
        outputDelayMode: outputDelayMode(),
        manualOutputDelay: manualOutputDelay(),
      }),
      (settings) => saveSettings(storage, settingsKey, settings),
      { defer: true },
    ),
  );

  const wakeLock = new ScreenWakeLock();
  // The browser releases the wake lock while the page is hidden.
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") wakeLock.reacquire();
  };
  onMount(() => document.addEventListener("visibilitychange", onVisibilityChange));
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    wakeLock.disable();
  });

  function changeBeatCount(count: number) {
    // Add settings before the count changes, so a new Beat never renders without them.
    if (count > beats.length) {
      setBeats((prev) => [...prev, ...defaultBeatsRange(prev.length, count)]);
    }
    setBeatCount(count);
  }

  // Restores every setting, including those of beats beyond the current count. Playback continues with the new settings.
  function resetSettings() {
    const defaults = defaultSettings();
    batch(() => {
      setBeats(defaults.beats);
      setBeatCount(defaults.beatCount);
      setTempo(defaults.tempo);
      setVolume(defaults.volume);
      setOutputDelayMode(defaults.outputDelayMode);
      setManualOutputDelay(defaults.manualOutputDelay);
    });
  }

  function nudgeTempo(delta: number) {
    setTempo((t) => clampTempo(t + delta));
  }

  function togglePlaying() {
    if (playing()) {
      metronome.stop();
      wakeLock.disable();
    } else {
      metronome.start();
      wakeLock.enable();
      readReportedDelay();
    }
    setPlaying((p) => !p);
  }

  // Tap times of the current tap tempo sequence.
  let taps: number[] = [];
  function tap() {
    const result = tapTempo(taps, performance.now());
    taps = result.taps;
    if (result.tempo !== null) setTempo(result.tempo);
  }

  // Space toggles playback; ArrowUp/ArrowDown change the tempo; T taps the tempo.
  // Keys are left to the focused element where it uses them itself: typing in a field,
  // Space on a checkbox, radio or subdivision button, arrows on a radio group or the slider.
  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = document.activeElement;
    if (isTextField(target)) return;
    if (e.key === " ") {
      if (isInputOfType(target, "checkbox", "radio")) return;
      // Also stops a focused button from being clicked by the same key press.
      e.preventDefault();
      if (!e.repeat) togglePlaying();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (isInputOfType(target, "radio", "range") || isLevelSlider(target)) return;
      e.preventDefault();
      nudgeTempo(e.key === "ArrowUp" ? 1 : -1);
    } else if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      if (!e.repeat) tap();
    }
  }
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  return (
    <main class="app">
      <header class="app-header">
        <h1>Metronome</h1>
        <p class="hint">
          <kbd>Space</kbd> start / stop <span aria-hidden="true">·</span> <kbd>↑</kbd> <kbd>↓</kbd> tempo{" "}
          <span aria-hidden="true">·</span> <kbd>T</kbd> tap
        </p>
      </header>

      <section class="transport" aria-label="Controls">
        <div class="tempo">
          <div class="tempo-row">
            <button
              type="button"
              class="round-button"
              aria-label="Decrease tempo"
              disabled={tempo() <= MIN_TEMPO}
              onClick={() => nudgeTempo(-1)}
            >
              −
            </button>
            <div class="tempo-readout">
              <input
                id="tempo"
                class="tempo-value"
                aria-label="Tempo in BPM"
                type="number"
                inputmode="numeric"
                min={MIN_TEMPO}
                max={MAX_TEMPO}
                step="1"
                value={tempo()}
                onChange={(e) => commitInteger(e.currentTarget, tempo, setTempo, MIN_TEMPO, MAX_TEMPO)}
              />
              <label for="tempo" class="tempo-unit">
                BPM <span class="tempo-marking">{tempoMarking(tempo())}</span>
              </label>
            </div>
            <button
              type="button"
              class="round-button"
              aria-label="Increase tempo"
              disabled={tempo() >= MAX_TEMPO}
              onClick={() => nudgeTempo(1)}
            >
              +
            </button>
          </div>
          <div class="tempo-slider-row">
            <input
              class="slider tempo-slider"
              type="range"
              aria-label="Tempo"
              aria-valuetext={`${tempo()} BPM`}
              min={MIN_TEMPO}
              max={MAX_TEMPO}
              step="1"
              value={tempo()}
              style={{ "--fill": `${((tempo() - MIN_TEMPO) / (MAX_TEMPO - MIN_TEMPO)) * 100}%` }}
              onInput={(e) => setTempo(clampTempo(Math.round(e.currentTarget.valueAsNumber)))}
            />
            {/* Taps count on press, for timing; a keyboard-activated click (detail 0) counts as one too. */}
            <button
              type="button"
              class="tap-button"
              aria-label="Tap tempo"
              aria-keyshortcuts="T"
              onPointerDown={(e) => {
                if (e.button === 0) tap();
              }}
              onClick={(e) => {
                if (e.detail === 0) tap();
              }}
            >
              Tap
            </button>
          </div>
        </div>

        <div class="meter">
          <label for="beat-count" class="control-label">
            Beats
          </label>
          <div class="stepper">
            <button
              type="button"
              class="round-button small"
              aria-label="Fewer beats"
              disabled={beatCount() <= 1}
              onClick={() => changeBeatCount(Math.max(1, beatCount() - 1))}
            >
              −
            </button>
            <input
              id="beat-count"
              class="stepper-value"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              value={beatCount()}
              onChange={(e) => commitInteger(e.currentTarget, beatCount, changeBeatCount, 1)}
            />
            <button
              type="button"
              class="round-button small"
              aria-label="More beats"
              onClick={() => changeBeatCount(beatCount() + 1)}
            >
              +
            </button>
          </div>
          <div class="bar-dots" aria-hidden="true">
            <Index each={Array.from({ length: beatCount() })}>
              {(_, index) => <span class="bar-dot" classList={{ active: activeBeat() === index, accent: beats[index].levels[0] === "maxAccent" }} />}
            </Index>
          </div>
        </div>

        <div class="actions">
          <button
            type="button"
            class="play-button"
            classList={{ playing: playing() }}
            aria-keyshortcuts="Space"
            onClick={togglePlaying}
          >
            <svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true">
              {playing() ? <rect x="6" y="6" width="12" height="12" rx="2" /> : <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />}
            </svg>
            <span>{playing() ? "Stop" : "Start"}</span>
          </button>
          <div class="volume">
            <svg class="volume-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path class="volume-speaker" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
              <path class="volume-waves" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
            </svg>
            <input
              class="slider volume-slider"
              type="range"
              aria-label="Volume"
              aria-valuetext={`${Math.round(volume() * 100)} %`}
              min="0"
              max="100"
              step="1"
              value={Math.round(volume() * 100)}
              style={{ "--fill": `${volume() * 100}%` }}
              onInput={(e) => setVolume(clampVolume(e.currentTarget.valueAsNumber / 100))}
            />
            <span class="volume-value" aria-hidden="true">
              {Math.round(volume() * 100)}%
            </span>
          </div>
          <button type="button" class="reset-button" aria-label="Reset settings" onClick={resetSettings}>
            <svg class="reset-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v4h4" />
            </svg>
            <span>Reset</span>
          </button>
        </div>

        <div class="delay">
          <div class="delay-row">
            <fieldset class="segmented delay-mode">
              <legend>Output delay</legend>
              <div class="segmented-track">
                <label class="segment">
                  <input
                    type="radio"
                    name="output-delay-mode"
                    value="automatic"
                    aria-describedby="delay-reported"
                    checked={outputDelayMode() === "automatic"}
                    onChange={() => changeOutputDelayMode("automatic")}
                  />
                  <span>Automatic</span>
                </label>
                <label class="segment">
                  <input
                    type="radio"
                    name="output-delay-mode"
                    value="manual"
                    checked={outputDelayMode() === "manual"}
                    onChange={() => changeOutputDelayMode("manual")}
                  />
                  <span>Manual</span>
                </label>
              </div>
            </fieldset>
            <span id="delay-reported" class="delay-reported">
              {reportedDelay() === null ? "not reported" : `browser reports ${reportedDelay()} ms`}
            </span>
            <Show when={outputDelayMode() === "manual"}>
              <div class="delay-slider-row">
                <input
                  class="slider delay-slider"
                  type="range"
                  aria-label="Manual output delay"
                  aria-valuetext={`${manualOutputDelay() ?? 0} ms`}
                  min="0"
                  max={MAX_OUTPUT_DELAY}
                  step="1"
                  value={manualOutputDelay() ?? 0}
                  style={{ "--fill": `${((manualOutputDelay() ?? 0) / MAX_OUTPUT_DELAY) * 100}%` }}
                  onInput={(e) => setManualOutputDelay(clampOutputDelay(Math.round(e.currentTarget.valueAsNumber)))}
                />
                <span class="delay-value" aria-hidden="true">
                  {manualOutputDelay() ?? 0} ms
                </span>
              </div>
            </Show>
          </div>
          <p class="delay-help">
            Bluetooth headphones and speakers usually add 40–300 ms. If the light and click don't line up, choose Manual
            and move the slider until they do.
          </p>
        </div>
      </section>

      <div class="beats">
        <Index each={beats.slice(0, beatCount())}>
          {(settings, index) => (
            <Beat
              index={index}
              settings={settings()}
              active={activeBeat() === index}
              activeSub={activeBeat() === index ? activeSub() : null}
              onSubDivisionChange={(n) => setBeats(index, "subDivision", n)}
              onLevelChange={(i, level) => setBeats(index, "levels", i, level)}
            />
          )}
        </Index>
      </div>
    </main>
  );
}
