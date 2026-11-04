import { expect, start, stop, test, waitForClicks } from "./fixtures";

declare global {
  interface Window {
    __capture: {
      ready: boolean;
      sampleRate: number;
      // Recorded signal and the audio clock frame of its first sample.
      dump(): Promise<{ startFrame: number; samples: number[] }>;
    };
  }
}

// Init script: records the signal sent to the destination, sample by sample, through an AudioWorklet
// connected in parallel to every node the app connects to the destination. Runs in the page.
function captureOutput() {
  const WORKLET = `
    class Capture extends AudioWorkletProcessor {
      constructor() {
        super();
        this.chunks = [];
        this.port.onmessage = () => this.port.postMessage(this.chunks.splice(0));
      }
      // Each block is stored with its frame, as process() is not always called for every render quantum.
      process(inputs) {
        if (this.chunks.length === 0 && !this.started) {
          this.started = true;
          this.port.postMessage("started");
        }
        const channel = inputs[0][0];
        this.chunks.push({ frame: currentFrame, data: channel ? channel.slice() : new Float32Array(128) });
        return true;
      }
    }
    registerProcessor("capture", Capture);`;
  const state = { ready: false, sampleRate: 0, node: null as AudioWorkletNode | null, pending: [] as AudioNode[] };
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const result = connect.apply(this, args);
    if (args[0] instanceof AudioDestinationNode && !(this instanceof AudioWorkletNode) && !(this as { __mute?: boolean }).__mute) {
      if (state.node) connect.call(this, state.node);
      else state.pending.push(this);
    }
    return result;
  } as AudioNode["connect"];

  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) {
      super(options);
      const ctx = this;
      state.sampleRate = ctx.sampleRate;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      void ctx.audioWorklet.addModule(url).then(() => {
        const node = new AudioWorkletNode(ctx, "capture", { channelCount: 1, channelCountMode: "explicit" });
        node.port.onmessage = () => {
          state.ready = true;
        };
        // The worklet must be pulled by the destination to run; a zero gain keeps it inaudible.
        const mute = new GainNode(ctx, { gain: 0 });
        (mute as unknown as { __mute: boolean }).__mute = true;
        connect.call(node, mute);
        connect.call(mute, ctx.destination);
        state.node = node;
        for (const n of state.pending) connect.call(n, node);
        state.pending = [];
      });
    }
  };

  window.__capture = {
    get ready() {
      return state.ready;
    },
    get sampleRate() {
      return state.sampleRate;
    },
    dump() {
      const port = state.node!.port;
      return new Promise((resolve) => {
        port.onmessage = (e) => {
          // Frames without a block are filled with zeros.
          const chunks = e.data as { frame: number; data: Float32Array }[];
          const startFrame = chunks[0].frame;
          const last = chunks[chunks.length - 1];
          const samples: number[] = new Array(last.frame + last.data.length - startFrame).fill(0);
          for (const c of chunks) c.data.forEach((v, i) => (samples[c.frame - startFrame + i] = v));
          resolve({ startFrame, samples });
        };
        port.postMessage("dump");
      });
    },
  };
}

test.describe("stop (Chromium)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "records the output with an AudioWorklet in Chromium");

  test("Stop during a click fades the output out without a step and silences later notes", async ({ page }) => {
    await page.addInitScript(captureOutput);
    await page.goto("/");
    await expect(page.locator(".beat")).toHaveCount(4);

    // A first run creates the AudioContext and starts the recorder.
    await start(page);
    await page.waitForFunction(() => window.__capture.ready);
    await stop(page);
    await page.waitForTimeout(200);

    await start(page);
    const before = (await waitForClicks(page, 1)).length;
    await waitForClicks(page, before + 8);
    // Presses Stop 3 ms after the onset of a scheduled click, on the audio clock.
    const { onset, hz, stopAt } = await page.evaluate(async () => {
      const ctx = window.__audio.contexts[0];
      const click = window.__audio.clicks.filter((c) => c.time > ctx.currentTime + 0.03).sort((a, b) => a.time - b.time)[0];
      const target = click.time + 0.003;
      while (ctx.currentTime < target - 0.012) await new Promise((r) => setTimeout(r, 1));
      while (ctx.currentTime < target) {
        // Waits for the audio clock to pass the target.
      }
      const at = ctx.currentTime;
      (document.querySelector(".play-button") as HTMLButtonElement).click();
      return { onset: click.time, hz: click.hz, stopAt: at };
    });
    await expect(page.locator(".play-button")).toHaveText("Start");
    await page.waitForTimeout(400);

    const { startFrame, samples: x } = await page.evaluate(() => window.__capture.dump());
    const sampleRate = await page.evaluate(() => window.__capture.sampleRate);
    const index = (time: number) => Math.round(time * sampleRate) - startFrame;
    const onsetAt = index(onset);
    const stopIndex = index(stopAt);
    expect(stopIndex - onsetAt, "stop lands 3 to 6 ms after the onset").toBeGreaterThanOrEqual(Math.round(0.003 * sampleRate));
    expect(stopIndex - onsetAt).toBeLessThan(Math.round(0.006 * sampleRate));
    expect(x.length).toBeGreaterThan(stopIndex + Math.round(0.3 * sampleRate));

    // The click is sounding when Stop is pressed.
    const peakBefore = Math.max(...x.slice(onsetAt, stopIndex).map(Math.abs));
    expect(peakBefore).toBeGreaterThan(0.1);

    // The output ends with a small step to zero: the last non-zero sample after the stop.
    let last = x.length - 1;
    while (last > stopIndex && x[last] === 0) last--;
    expect(last, "output ends after the stop").toBeGreaterThan(stopIndex);
    expect(Math.abs(x[last]), "step to zero").toBeLessThan(0.02);

    // No jump during the fade: each sample stays close to the continuation of the click's sine wave.
    const c = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
    let jump = 0;
    for (let i = stopIndex; i <= last + 1; i++) jump = Math.max(jump, Math.abs(x[i] - (c * x[i - 1] - x[i - 2])));
    expect(jump, "largest deviation from the sine continuation").toBeLessThan(0.05);

    // Within 20 ms the output is below -60 dBFS, and after that nothing sounds, including later notes.
    const tail = x.slice(stopIndex + Math.round(0.02 * sampleRate));
    expect(Math.max(...tail.map(Math.abs)), "level 20 ms after the stop").toBeLessThan(0.001);
    const silent = x.slice(stopIndex + Math.round(0.05 * sampleRate));
    expect(silent.every((v) => v === 0), "silence 50 ms after the stop").toBe(true);
  });
});
