import { For, Index } from "solid-js";
import { LEVELS, levelAtPosition, type BeatSettings, type Level } from "./metronome";

// Level names as read out as each subdivision slider's value.
const LEVEL_NAMES: Record<Level, string> = {
    mute: "mute",
    normal: "normal",
    accent: "accent",
    maxAccent: "max accent",
};

// Level bands of a subdivision cell from top to bottom, as levelAtPosition maps them.
const BANDS = [...LEVELS].reverse();

export default function Beat(props: {
    index: number;
    settings: BeatSettings;
    // Whether this beat is sounding, and which of its subdivisions is (null when none).
    active: boolean;
    activeSub: number | null;
    onSubDivisionChange: (subDivision: number) => void;
    onLevelChange: (sub: number, level: Level) => void;
}) {
    // Sets a subdivision's level from the pointer's vertical position in its cell.
    const setFromPointer = (sub: number, current: Level, e: PointerEvent & { currentTarget: HTMLElement }) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const level = levelAtPosition(e.clientY - rect.top, rect.height);
        if (level !== current) props.onLevelChange(sub, level);
    };
    const onPointerDown = (sub: number, current: Level, e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromPointer(sub, current, e);
    };
    const onPointerMove = (sub: number, current: Level, e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(sub, current, e);
    };
    const onPointerEnd = (e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    // Arrow keys step one level (no wrap), Home and End go to the lowest and highest, digits 0-3 set it.
    const onKeyDown = (sub: number, current: Level, e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const index = LEVELS.indexOf(current);
        let next: number;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") next = Math.min(index + 1, LEVELS.length - 1);
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = LEVELS.length - 1;
        else if (e.key.length === 1 && e.key >= "0" && e.key < String(LEVELS.length)) next = Number(e.key);
        else return;
        e.preventDefault();
        if (next !== index) props.onLevelChange(sub, LEVELS[next]);
    };
    const subDivisionChoices = [1, 2, 3, 4, 5, 6, 7, 8];
    const headingId = () => `beat-${props.index}-heading`;
    return (
        <section
            class="beat"
            classList={{ active: props.active, accent: props.settings.levels[0] === "maxAccent" }}
            aria-labelledby={headingId()}
        >
            <header class="beat-head">
                <h2 id={headingId()}>
                    <span class="beat-label">Beat</span> <span class="beat-number">{props.index + 1}</span>
                </h2>
            </header>
            <fieldset class="segmented">
                <legend>Subdivision</legend>
                <div class="segmented-track">
                    <For each={subDivisionChoices}>
                        {(choice) => (
                            <label class="segment">
                                <input
                                    type="radio"
                                    name={`subdivision-${props.index}`}
                                    value={choice}
                                    checked={props.settings.subDivision === choice}
                                    onChange={() => props.onSubDivisionChange(choice)}
                                />
                                <span>{choice}</span>
                            </label>
                        )}
                    </For>
                </div>
            </fieldset>
            <div class="subs" role="group" aria-label={`Beat ${props.index + 1} notes`}>
                {/* Each cell is a vertical slider: a press or drag sets the level from the pointer's height. */}
                <Index each={props.settings.levels.slice(0, props.settings.subDivision)}>
                    {(level, i) => (
                        <div
                            class="sub"
                            classList={{ active: props.activeSub === i }}
                            data-level={level()}
                            role="slider"
                            tabindex="0"
                            aria-label={`Subdivision ${i + 1}`}
                            aria-orientation="vertical"
                            aria-valuemin={0}
                            aria-valuemax={LEVELS.length - 1}
                            aria-valuenow={LEVELS.indexOf(level())}
                            aria-valuetext={LEVEL_NAMES[level()]}
                            onPointerDown={(e) => onPointerDown(i, level(), e)}
                            onPointerMove={(e) => onPointerMove(i, level(), e)}
                            onPointerUp={onPointerEnd}
                            onPointerCancel={onPointerEnd}
                            onKeyDown={(e) => onKeyDown(i, level(), e)}
                        >
                            {/* One segment per level band, top to bottom, aligned with levelAtPosition's quarters. */}
                            <For each={BANDS}>
                                {(band) => (
                                    <span class="sub-seg" data-band={band} aria-hidden="true">
                                        {band === "mute" && (
                                            <svg class="sub-mute-icon" viewBox="0 0 10 10">
                                                <path d="M2 2l6 6M8 2l-6 6" />
                                            </svg>
                                        )}
                                    </span>
                                )}
                            </For>
                        </div>
                    )}
                </Index>
            </div>
        </section>
    );
}
