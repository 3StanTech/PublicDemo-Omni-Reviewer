import type { DemoApi } from "./contract";
import { readyFirebase } from "./firebase";
import { getLoadedPack, listPacks, loadPack } from "./packs";
import {
  getProgress, getSession, recordAttempts, resetProgress,
  reviewCard, saveSession, setExamDate,
} from "./progress";
import { replayAsk, replayGeneration } from "./replay";

export const demoApi: DemoApi = {
  async ready() {
    const { uid } = await readyFirebase();
    return { uid };
  },
  listPacks,
  loadPack,
  getProgress,
  reviewCard,
  recordAttempts,
  getSession,
  saveSession,
  setExamDate,
  replayGeneration(id, onStep, signal) {
    return replayGeneration(getLoadedPack(id), onStep, signal);
  },
  replayAsk(id, askId) {
    return replayAsk(getLoadedPack(id), askId);
  },
  resetProgress,
};
