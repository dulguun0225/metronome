// AudioWorklet processor that plays the metronome's clicks on the audio thread. Built into a single
// script and loaded from a data: URL (see the worklet plugin in vite.config.ts and metronome.ts).
import { ClickGenerator, PROCESSOR_NAME, type ProcessorMessage, type ProcessorOptions } from "./clickGenerator";

// Globals of AudioWorkletGlobalScope, which the DOM type library does not declare.
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new (options: { processorOptions: ProcessorOptions }) => AudioWorkletProcessor,
): void;

// Renders one mono output and posts the notes started in each block to the main thread.
class ClickProcessor extends AudioWorkletProcessor {
  #generator: ClickGenerator;

  constructor(options: { processorOptions: ProcessorOptions }) {
    super();
    this.#generator = new ClickGenerator(sampleRate, options.processorOptions.settings);
    this.port.onmessage = (e: MessageEvent<ProcessorMessage>) => {
      if (e.data.type === "settings") this.#generator.setSettings(e.data.settings);
      else this.#generator.stop();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const notes = this.#generator.render(outputs[0][0], currentFrame);
    if (notes.length > 0) this.port.postMessage(notes);
    // After stop, the node is kept until its last click has ended.
    return !this.#generator.done;
  }
}

registerProcessor(PROCESSOR_NAME, ClickProcessor);
