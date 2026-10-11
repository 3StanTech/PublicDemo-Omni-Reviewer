import type { DemoPack, PackId, PackSummary } from "./contract";
import { demoPackSchema, manifestSchema, packIdSchema } from "./pack-schema";

let manifest: Promise<PackSummary[]> | undefined;
const pendingPacks = new Map<PackId, Promise<DemoPack>>();
const loadedPacks = new Map<PackId, DemoPack>();

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Sample pack could not be loaded (${response.status}).`);
  return response.json();
}

export function listPacks(): Promise<PackSummary[]> {
  manifest ??= readJson("/packs/manifest.json")
    .then((json) => manifestSchema.parse(json))
    .catch((error: unknown) => { manifest = undefined; throw error; });
  return manifest;
}

export function loadPack(id: PackId): Promise<DemoPack> {
  packIdSchema.parse(id);
  let pending = pendingPacks.get(id);
  if (!pending) {
    pending = readJson(`/packs/${id}.json`).then((json) => {
      const pack = demoPackSchema.parse(json);
      if (pack.id !== id) throw new Error("Sample pack identity does not match its path.");
      loadedPacks.set(id, pack);
      return pack;
    }).catch((error: unknown) => { pendingPacks.delete(id); throw error; });
    pendingPacks.set(id, pending);
  }
  return pending;
}

/** Replays use already loaded content, so starting one cannot issue a request. */
export function getLoadedPack(id: PackId): DemoPack {
  packIdSchema.parse(id);
  const pack = loadedPacks.get(id);
  if (!pack) throw new Error("Open the sample pack before playing a recorded run.");
  return pack;
}
