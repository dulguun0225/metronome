import { For, Index } from "solid-js";
import { nextLevel, type BeatSettings, type Level } from "./metronome";

// Level names as read out and stated in each subdivision button's accessible name.
const LEVEL_NAMES: Record<Level, string> = {
    mute: "mute",
    normal: "normal",
    accent: "accent",
    maxAccent: "max accent",
};

export default function Beat(props: {
    index: number;
    settings: BeatSettings;
    // Whether this beat is sounding, and which of its subdivisions is (null when none).
    active: boolean;
    activeSub: number | null;
    onSubDivisionChange: (subDivision: number) => void;
    onLevelChange: (sub: number, level: Level) => void;
}) {
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
                {/* Each click (also Enter or Space) steps the subdivision to the next level. */}
                <Index each={props.settings.levels.slice(0, props.settings.subDivision)}>
                    {(level, i) => (
                        <button
                            type="button"
                            class="sub"
                            classList={{ active: props.activeSub === i }}
                            data-level={level()}
                            aria-label={`Subdivision ${i + 1}: ${LEVEL_NAMES[level()]}`}
                            onClick={() => props.onLevelChange(i, nextLevel(level()))}
                        >
                            <span class="sub-mark" aria-hidden="true" />
                        </button>
                    )}
                </Index>
            </div>
        </section>
    );
}
