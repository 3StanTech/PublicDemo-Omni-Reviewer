import type { DemoPack, RecordedStep } from "./contract";

function aborted(): Error {
  const error = new Error("Recorded run cancelled.");
  error.name = "AbortError";
  return error;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export async function replayGeneration(
  pack: DemoPack,
  onStep: (step: RecordedStep, index: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = pack.generation.reduce((sum, step) => sum + step.ms, 0);
  const scale = total > 8_000 ? 8_000 / total : 1;
  for (const [index, step] of pack.generation.entries()) {
    if (signal?.aborted) throw aborted();
    onStep(step, index);
    await wait(Math.floor(step.ms * scale), signal);
  }
}

export async function* replayAsk(pack: DemoPack, askId: string): AsyncIterable<string> {
  const ask = pack.asks.find((entry) => entry.id === askId);
  if (!ask) throw new Error("That recorded answer is not in this sample pack.");
  // Stream text without splitting Unicode code points or changing the answer.
  const characters = Array.from(ask.answer);
  const chunkSize = Math.max(32, Math.ceil(characters.length / 100));
  for (let offset = 0; offset < characters.length; offset += chunkSize) {
    await wait(24);
    yield characters.slice(offset, offset + chunkSize).join("");
  }
}
