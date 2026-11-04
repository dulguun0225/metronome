import { batch, createSignal, Index, onCleanup, onMount, type Accessor } from "solid-js";
import { createStore } from "solid-js/store";
import Beat from "./Beat";
import { Metronome, type BeatSettings } from "./metronome";

const MIN_TEMPO = 20;
const MAX_TEMPO = 300;
const MAX_SUBDIVISION = 8;

// Input types that are not typed into; key presses on them are not text entry.
const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "color", "file", "image"]);

function defaultBeatSettings(): BeatSettings {
  // One flag per possible subdivision, sized to the largest choice so flags are kept when the subdivision changes.
  return { subDivision: 4, enabled: Array.from({ length: MAX_SUBDIVISION }, () => true) };
}

function clampTempo(n: number) {
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, n));
}

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
  const [beatCount, setBeatCount] = createSignal(4);
  const [tempo, setTempo] = createSignal(120);
  const [playing, setPlaying] = createSignal(false);
  // Settings for every beat ever shown, not only the first beatCount, so they are kept when the count is lowered then raised.
  const [beats, setBeats] = createStore<BeatSettings[]>(Array.from({ length: beatCount() }, defaultBeatSettings));
  const [activeBeat, setActiveBeat] = createSignal<number | null>(null);
  const [activeSub, setActiveSub] = createSignal<number | null>(null);

  const metronome = new Metronome(
    () => ({ tempo: tempo(), beatCount: beatCount(), beats }),
    (pos) =>
      batch(() => {
        setActiveBeat(pos?.beat ?? null);
        setActiveSub(pos?.sub ?? null);
      }),
  );
  onCleanup(() => metronome.dispose());

  function changeBeatCount(count: number) {
    // Add settings before the count changes, so a new Beat never renders without them.
    if (count > beats.length) {
      setBeats((prev) => [...prev, ...Array.from({ length: count - prev.length }, defaultBeatSettings)]);
    }
    setBeatCount(count);
  }

  function nudgeTempo(delta: number) {
    setTempo((t) => clampTempo(t + delta));
  }

  function togglePlaying() {
    if (playing()) metronome.stop();
    else metronome.start();
    setPlaying((p) => !p);
  }

  // Space toggles playback; ArrowUp/ArrowDown change the tempo.
  // Keys are left to the focused element where it uses them itself: typing in a field,
  // Space on a checkbox or radio, arrows on a radio group or the slider.
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
      if (isInputOfType(target, "radio", "range")) return;
      e.preventDefault();
      nudgeTempo(e.key === "ArrowUp" ? 1 : -1);
    }
  }
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  return (
    <main class="app">
      <header class="app-header">
        <h1>Metronome</h1>
        <p class="hint">
          <kbd>Space</kbd> start / stop <span aria-hidden="true">·</span> <kbd>↑</kbd> <kbd>↓</kbd> tempo
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
          <input
            class="tempo-slider"
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
        </div>

        <div class="meter">
          <label for="beat-count" class="control-label">
            Beats per bar
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
              {(_, index) => <span class="bar-dot" classList={{ active: activeBeat() === index, accent: index === 0 }} />}
            </Index>
          </div>
        </div>

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
              onEnabledChange={(i, on) => setBeats(index, "enabled", i, on)}
            />
          )}
        </Index>
      </div>
    </main>
  );
}
