import { For, Index } from "solid-js";
import type { BeatSettings } from "./metronome";

export default function Beat(props: {
    index: number;
    settings: BeatSettings;
    // Whether this beat is sounding, and which of its subdivisions is (null when none).
    active: boolean;
    activeSub: number | null;
    onSubDivisionChange: (subDivision: number) => void;
    onEnabledChange: (sub: number, enabled: boolean) => void;
    onAccentChange: (accent: boolean) => void;
}) {
    const subDivisionChoices = [1, 2, 3, 4, 5, 6, 7, 8];
    const headingId = () => `beat-${props.index}-heading`;
    return (
        <section
            class="beat"
            classList={{ active: props.active, accent: props.settings.accent }}
            aria-labelledby={headingId()}
        >
            <header class="beat-head">
                <h2 id={headingId()}>
                    <span class="beat-label">Beat</span> <span class="beat-number">{props.index + 1}</span>
                </h2>
                <label class="accent-toggle">
                    <input
                        type="checkbox"
                        aria-label={`Accent beat ${props.index + 1}`}
                        checked={props.settings.accent}
                        onChange={(e) => props.onAccentChange(e.currentTarget.checked)}
                    />
                    <span aria-hidden="true">Accent</span>
                </label>
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
                <Index each={props.settings.enabled.slice(0, props.settings.subDivision)}>
                    {(on, i) => (
                        <label class="sub" classList={{ active: props.activeSub === i, off: !on() }}>
                            <input
                                type="checkbox"
                                aria-label={`Subdivision ${i + 1}`}
                                checked={on()}
                                onChange={(e) => props.onEnabledChange(i, e.currentTarget.checked)}
                            />
                            <span class="sub-mark" aria-hidden="true" />
                        </label>
                    )}
                </Index>
            </div>
        </section>
    );
}
