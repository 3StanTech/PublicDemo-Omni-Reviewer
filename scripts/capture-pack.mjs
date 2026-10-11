#!/usr/bin/env node
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const usage = `Usage:
  node scripts/capture-pack.mjs --base http://localhost:3100 --reviewer <id> --pack-id <PackId>
  node scripts/capture-pack.mjs --help

PackId: staining-microscopy | prokaryotic-cell | antimicrobial-drugs
Environment: DEMO_USER_EMAIL and DEMO_USER_PASSWORD (never written to disk).
The server must be local. Only completed, unedited packs with two recorded Ask
answers and pasted OpenStax text are exported. Output: public/packs/<PackId>.json
and public/packs/manifest.json, relative to this repository, regardless of cwd.
Source text without page markers must be shorter than the API's 20,000-character
whole-source limit. Larger text cannot be captured completely by that API.
`;
const definitions = {
  "staining-microscopy": { name: "Staining and microscopy", sections: ["2.3", "2.4"] },
  "prokaryotic-cell": { name: "Prokaryotic cell structure", sections: ["3.3"] },
  "antimicrobial-drugs": { name: "Antimicrobial drugs", sections: ["14.1", "14.2", "14.3"] },
};
const modes = ["locked_in", "summary", "test_me", "carded"];
const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));

function options(args) {
  if (args.length === 1 && args[0] === "--help") return null;
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--base", "--reviewer", "--pack-id"].includes(flag) || parsed[flag] || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error("Invalid arguments. Use --help for usage.");
    }
    parsed[flag] = args[index + 1];
  }
  if (!parsed["--base"] || !parsed["--reviewer"] || !Object.hasOwn(definitions, parsed["--pack-id"])) {
    throw new Error("Supply --base, --reviewer and a supported --pack-id. Use --help for usage.");
  }
  const base = new URL(parsed["--base"]);
  if (base.hostname !== "localhost" || !["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Refusing base URL: use an http(s) localhost origin with no credentials, path, query or fragment.");
  }
  return { base, reviewer: parsed["--reviewer"], packId: parsed["--pack-id"] };
}

function safePath(path) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Refusing a path outside the demo repository.");
  let current = root;
  for (const segment of rel.split("/").filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Refusing symbolic links in capture paths.");
    // lstat also detects a dangling symlink that existsSync would miss.
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Refusing symbolic links in capture paths.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return path;
}

function assertPublic(value, path = "pack") {
  if (typeof value === "string") {
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) throw new Error(`${path}: refusing email-like content.`);
    for (const match of value.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'\[\]]+/gi)) {
      const raw = match[0].replace(/[).,;!?]+$/, "");
      const url = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
      if (!(url.hostname === "openstax.org" || url.hostname.endsWith(".openstax.org")) || url.username || url.password) {
        throw new Error(`${path}: refusing a URL outside openstax.org.`);
      }
    }
    // Also catch bare host/path and scheme-relative links in prose or Markdown.
    for (const match of value.matchAll(/(?:\/\/)?\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w.%~/?#=&+-]*)?/gi)) {
      const host = match[0].replace(/^\/\//, "").split("/")[0].toLowerCase();
      if (host === "openstax.org" || host.endsWith(".openstax.org")) continue;
      // Citation notation such as p.14 and scientific abbreviations such as
      // E. coli are not hosts; a contiguous dotted word can be a filename.
      if (/\.(?:json|md|txt|pdf)$/i.test(host)) continue;
      throw new Error(`${path}: refusing a bare URL outside openstax.org.`);
    }
  } else if (Array.isArray(value)) value.forEach((entry, index) => assertPublic(entry, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, entry]) => {
    assertPublic(key, `${path}.key`);
    assertPublic(entry, `${path}.${key}`);
  });
}

async function capture({ base, reviewer, packId }) {
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password) throw new Error("Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD in the environment.");
  // All imports and explicit filesystem operations are rooted in this repo.
  const { tsImport } = await import("tsx/esm/api");
  const importLocal = (name) => tsImport(pathToFileURL(safePath(join(root, name))).href, {
    parentURL: import.meta.url, tsconfig: safePath(join(root, "tsconfig.json")),
  });
  const { demoPackSchema, manifestSchema } = await importLocal("lib/demo/pack-schema.ts");
  const { assertNoBannedIdentifiers } = await import(pathToFileURL(safePath(join(root, "scripts/check-public-safe.mjs"))).href);
  const { parseCardedItems, parseTestMeItems } = await importLocal("lib/learning.ts");
  const { countClaims, parseCitations, readStudyDocumentMeta } = await importLocal("lib/citations.ts");
  const cookies = new Map();
  async function request(path, init = {}) {
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error("Refusing a request outside the selected localhost origin.");
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([key, val]) => `${key}=${val}`).join("; "));
    const response = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    if (!response.ok) throw new Error(`Local API ${url.pathname} returned HTTP ${response.status}.`);
    return response.json();
  }
  const csrf = await request("/api/auth/csrf");
  if (typeof csrf.csrfToken !== "string" || !csrf.csrfToken) throw new Error("The local sign-in returned no CSRF token.");
  const signIn = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, callbackUrl: base.href }),
  });
  if (typeof signIn.url !== "string") throw new Error("Local credentials sign-in returned no redirect.");
  const redirect = new URL(signIn.url, base);
  if (redirect.origin !== base.origin || redirect.searchParams.has("error")) throw new Error("Local credentials sign-in failed.");
  const session = await request("/api/auth/session");
  if (session.user?.email?.toLowerCase() !== email.trim().toLowerCase()) throw new Error("Local session does not match the selected demo user.");

  const prefix = `/api/reviewers/${encodeURIComponent(reviewer)}`;
  const rawViews = await request(`${prefix}/views`);
  const cardResponse = await request(`${prefix}/cards`);
  const rawSources = await request(`${prefix}/sources`);
  const generationResponse = await request(`${prefix}/generation`);
  const jobId = generationResponse.jobId ?? generationResponse.job?.id;
  if (typeof jobId !== "string") throw new Error("No recorded generation job exists.");
  const { job } = await request(`${prefix}/generation/${encodeURIComponent(jobId)}`);
  if (job?.status !== "succeeded" || job.active || job.mode !== "full") throw new Error("Capture requires a completed full generation run.");
  if (rawViews.staleKinds?.length) throw new Error("Capture refuses stale study modes.");
  for (const kind of modes) {
    const view = rawViews[kind];
    if (!view || view.stale || view.isEdited || view.isPinned || view.generationRunId !== job.generationRunId) {
      throw new Error(`Capture requires the unedited ${kind} view from the completed run.`);
    }
  }
  const lockedMeta = readStudyDocumentMeta(rawViews.locked_in.contentJson);
  if (!lockedMeta?.citationSources.length) throw new Error("Locked In has no source map.");
  const refs = [...lockedMeta.citationSources].sort((a, b) => a.index - b.index);
  if (!Array.isArray(rawSources) || rawSources.length !== definitions[packId].sections.length || refs.length !== rawSources.length) {
    throw new Error("The pack must have exactly one pasted source per approved section, all in its citation map.");
  }
  refs.forEach((ref, index) => {
    if (ref.index !== index + 1) throw new Error("The citation map must use consecutive source indexes.");
  });
  const sourceMap = new Map(refs.map((ref, index) => [ref.sourceId, `source-${index + 1}`]));
  if (sourceMap.size !== refs.length) throw new Error("The source map contains duplicate identities.");
  const sources = [];
  for (const [index, ref] of refs.entries()) {
    const source = rawSources.find((row) => row.id === ref.sourceId);
    if (!source || source.kind !== "paste" || source.ingestStatus !== "ready" || source.blobPathname || source.blobUrl) {
      throw new Error("Only ready pasted-text sources can be captured.");
    }
    const path = `${prefix}/sources/${encodeURIComponent(ref.sourceId)}?view=text`;
    const overview = await request(path);
    if (!Number.isInteger(overview.pageCount) || overview.pageCount < 0 || overview.pageCount > 1_000 || typeof overview.text !== "string") {
      throw new Error("The source text response is incomplete.");
    }
    const pages = [];
    if (overview.pageCount === 0) {
      if (overview.text.length >= 20_000) throw new Error("Source text reaches the local API's 20,000-character cap; complete capture is unavailable. Use shorter pasted sources before generating.");
      pages.push({ n: 0, text: overview.text });
    } else {
      for (let n = 0; n <= overview.pageCount; n++) {
        const page = await request(`${path}&page=${n}`);
        if (n === 0 && !page.text) continue;
        if (typeof page.text !== "string" || !page.text.trim()) throw new Error(`Source page ${n} is missing or empty.`);
        pages.push({ n, text: page.text });
      }
    }
    sources.push({ id: sourceMap.get(ref.sourceId), label: `OpenStax Microbiology §${definitions[packId].sections[index]}`, pages });
  }

  const rawCards = parseCardedItems(rawViews.carded.contentJson, rawViews.carded.content);
  const rawTests = parseTestMeItems(rawViews.test_me.contentJson, rawViews.test_me.content);
  if (!rawCards.length || !rawTests.length || !Array.isArray(rawViews.carded.contentJson) || rawCards.length !== rawViews.carded.contentJson.length || !Array.isArray(rawViews.test_me.contentJson) || rawTests.length !== rawViews.test_me.contentJson.length) {
    throw new Error("A generated practice payload contains invalid or missing items.");
  }
  if (!Array.isArray(cardResponse.cards) || cardResponse.cards.length !== rawCards.length) throw new Error("Durable cards do not match the completed run.");
  const cards = rawCards.map((card, index) => {
    const persisted = cardResponse.cards.find((row) => row.sourceKey === card.id);
    if (!persisted || persisted.isEdited || persisted.isPinned || persisted.front !== card.front || persisted.back !== card.back) {
      throw new Error("A durable card differs from the original generated content.");
    }
    return { id: `card-${String(index + 1).padStart(3, "0")}`, front: card.front, back: card.back, ...(card.kind ? { kind: card.kind } : {}) };
  });
  const testItems = rawTests.map((item, index) => ({
    id: `test-${String(index + 1).padStart(3, "0")}`, question: item.question,
    ...(item.choices ? { choices: item.choices } : {}), answer: item.answer, explanation: item.explanation,
  }));
  function citationMeta(raw) {
    const meta = readStudyDocumentMeta(raw);
    if (!meta) throw new Error("A reading view has no citation metadata.");
    return {
      citationSources: meta.citationSources.map((ref) => {
        const index = refs.findIndex((entry) => entry.sourceId === ref.sourceId);
        if (index < 0 || refs[index].index !== ref.index) throw new Error("Reading modes disagree on source indexes.");
        return { index: ref.index, sourceId: sourceMap.get(ref.sourceId), filename: sources[index].label, hasPages: sources[index].pages.some((page) => page.n > 0) };
      }),
      ...(meta.grounding ? { grounding: meta.grounding } : {}),
    };
  }
  const views = { currentGenerationRunId: null, staleKinds: [] };
  for (const kind of modes) {
    const raw = rawViews[kind];
    const contentJson = kind === "carded" ? cards : kind === "test_me" ? testItems : citationMeta(raw.contentJson);
    views[kind] = {
      id: `${packId}-${kind.replaceAll("_", "-")}`, reviewerId: "", kind,
      content: kind === "carded" || kind === "test_me" ? JSON.stringify(contentJson) : raw.content,
      contentJson, generatedAt: "", updatedAt: "", contentRevision: 1,
      annotationRevision: 1, revision: 1, isEdited: false, isPinned: false,
    };
  }
  // The API has no per-step duration log. Completion deltas include local
  // orchestration time; parallel modes can have a zero delta in display order.
  let previous = Date.parse(job.createdAt);
  if (!Number.isFinite(previous)) throw new Error("Generation start time is missing.");
  const generation = modes.map((step) => {
    const end = Date.parse(rawViews[step].generatedAt);
    if (!Number.isFinite(end) || end < Date.parse(job.createdAt)) throw new Error("Generation completion time is invalid.");
    const ms = Math.max(0, end - previous);
    previous = Math.max(previous, end);
    return { step, ms };
  });
  const askResponse = await request(`${prefix}/ask`);
  if (!Array.isArray(askResponse.messages)) throw new Error("The recorded Ask thread is missing.");
  const asks = [];
  for (const answer of askResponse.messages) {
    if (answer.role !== "assistant" || answer.refused || answer.origin?.kind !== "ask") continue;
    const question = askResponse.messages.find((message) => message.id === answer.replyToId && message.role === "user");
    if (!question) throw new Error("A recorded answer has no matching question.");
    const askRefs = new Map((answer.citationSources ?? []).map((ref) => [ref.index, refs.findIndex((entry) => entry.sourceId === ref.sourceId) + 1]));
    const content = answer.content.replace(/\[S(\d{1,2})([^\]]*)\]/g, (_raw, index, suffix) => {
      const mapped = askRefs.get(Number(index));
      if (!mapped) throw new Error("A recorded answer cites a source outside this pack.");
      return `[S${mapped}${suffix}]`;
    });
    if (!parseCitations(content).length) throw new Error("Recorded answers must have citations.");
    asks.push({ id: `ask-${asks.length + 1}`, question: question.content, answer: content });
  }
  if (asks.length !== 2 || new Set(asks.map((ask) => ask.question)).size !== 2) throw new Error("Capture requires exactly two distinct recorded Ask answers.");
  const claims = countClaims(rawViews.locked_in.content);
  const pack = demoPackSchema.parse({
    id: packId, ...definitions[packId], cardCount: cards.length, testItemCount: testItems.length,
    views, cards, testItems, sources, generation, asks,
    unsourcedPercent: claims.total ? Math.round(claims.unsourced / claims.total * 10_000) / 100 : null,
  });
  assertPublic(pack);
  const serialized = JSON.stringify(pack, null, 2) + "\n";
  assertNoBannedIdentifiers(serialized);
  for (const id of [reviewer, session.user?.id, job.id, job.generationRunId, ...rawSources.map((source) => source.id), ...cardResponse.cards.map((card) => card.id), ...modes.map((kind) => rawViews[kind].id)]) {
    if (typeof id === "string" && id.length >= 8 && serialized.includes(id)) throw new Error("An original private identity remains in the export.");
  }
  // Check every citation against its mapped source and available page numbers.
  for (const content of [views.locked_in.content, views.summary.content, ...cards.flatMap((card) => [card.front, card.back]), ...testItems.flatMap((item) => [item.question, item.answer, item.explanation, ...(item.choices ?? [])]), ...asks.map((ask) => ask.answer)]) {
    for (const citation of parseCitations(content)) {
      const source = sources[citation.source - 1];
      if (!source) throw new Error("An exported citation references an unknown source.");
      if (citation.pageStart !== null) {
        for (let n = citation.pageStart; n <= citation.pageEnd; n++) {
          if (!source.pages.some((page) => page.n === n)) throw new Error("An exported citation references a missing page.");
        }
      }
    }
  }
  const outputDir = safePath(join(root, "public/packs"));
  mkdirSync(outputDir, { recursive: true });
  const packPath = safePath(join(outputDir, `${packId}.json`));
  const manifestPath = safePath(join(outputDir, "manifest.json"));
  const existing = existsSync(manifestPath) ? manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8"))) : [];
  assertPublic(existing, "manifest");
  assertNoBannedIdentifiers(JSON.stringify(existing));
  const summary = { id: packId, ...definitions[packId], cardCount: cards.length, testItemCount: testItems.length };
  const manifest = manifestSchema.parse(Object.keys(definitions).flatMap((id) => {
    const entry = id === packId ? summary : existing.find((item) => item.id === id);
    return entry ? [entry] : [];
  }));
  function atomicWrite(path, content) {
    const temp = safePath(`${path}.${process.pid}.tmp`);
    let owned = false;
    try { writeFileSync(temp, content, { flag: "wx" }); owned = true; renameSync(temp, path); }
    finally { if (owned && existsSync(temp)) unlinkSync(temp); }
  }
  atomicWrite(packPath, serialized);
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Captured ${packId} to public/packs; unsourced claims: ${pack.unsourcedPercent === null ? "not measured" : `${pack.unsourcedPercent}%`}.`);
}

try {
  const parsed = options(process.argv.slice(2));
  if (!parsed) console.log(usage);
  else await capture(parsed);
} catch (error) {
  // API responses, cookies, credentials and raw content never enter errors.
  console.error(`Capture failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
