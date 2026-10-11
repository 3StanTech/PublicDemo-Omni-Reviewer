import { readFileSync } from "node:fs";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp,
  type DocumentData,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const UID = "visitor-one";
const PACK = "prokaryotic-cell";
const now = () => Timestamp.now();
const old = () => Timestamp.fromMillis(Date.now() - 10_000);
const fixtures: { name: string; path: string; data: () => DocumentData; wrong: DocumentData }[] = [
  { name: "profile", path: `demos/${UID}`, data: () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), wrong: { createdAt: "today" } },
  { name: "cards", path: `demos/${UID}/cards/${PACK}__card-001`, data: () => ({
    packId: PACK, cardId: "card-001", dueAt: now(), intervalDays: 1,
    repetitions: 1, easeFactor: 25, lastReviewedAt: now(), revision: 2, updatedAt: serverTimestamp(),
    firstReviewedAt: serverTimestamp(),
    fsrsState: 2, stability: 3.5, difficulty: 5, lapses: 0, scheduledDays: 1,
  }), wrong: { intervalDays: "one" } },
  { name: "attempts", path: `demos/${UID}/attempts/${PACK}__test-001`, data: () => ({
    attempts: 1, misses: 0, lastAttemptedAt: now(), updatedAt: serverTimestamp(),
  }), wrong: { attempts: "one" } },
  { name: "sessions", path: `demos/${UID}/sessions/${PACK}__practice`, data: () => ({ state: '{"current":1}', updatedAt: serverTimestamp() }), wrong: { state: {} } },
  { name: "packs", path: `demos/${UID}/packs/${PACK}`, data: () => ({ examDate: "2026-11-01", lastOpenedAt: now(), updatedAt: serverTimestamp() }), wrong: { examDate: 42 } },
];
let environment: RulesTestEnvironment;

beforeAll(async () => {
  // Never contact the live database if this suite is invoked without the CLI.
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error("Run this suite with npm run test:rules (Firestore emulator required).");
  const separator = address.lastIndexOf(":");
  const host = address.slice(0, separator);
  const port = Number(address.slice(separator + 1));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host) || !Number.isInteger(port) || port <= 0) {
    throw new Error("Rules tests require a local Firestore emulator.");
  }
  environment = await initializeTestEnvironment({
    projectId: "demo-omni-reviewer-rules",
    firestore: { host, port, rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});
beforeEach(async () => { await environment.clearFirestore(); });
afterAll(async () => { await environment?.cleanup(); });

function visitor(uid: string | null = UID) {
  return uid === null ? environment.unauthenticatedContext().firestore()
    : environment.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
}

async function seed(path: string, data: DocumentData) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), { ...data, updatedAt: old(), ...(path === `demos/${UID}` ? { createdAt: old() } : {}) });
  });
}

describe.each(fixtures)("$name isolation and schema", (fixture) => {
  it("lets the owner create and read", async () => {
    const db = visitor();
    await assertSucceeds(setDoc(doc(db, fixture.path), fixture.data()));
    await assertSucceeds(getDoc(doc(db, fixture.path)));
    if (fixture.name !== "profile") await assertSucceeds(getDocs(collection(db, "demos", UID, fixture.name)));
  });
  it("lets the owner update after the interval", async () => {
    await seed(fixture.path, fixture.data());
    const db = visitor();
    const existing = (await getDoc(doc(db, fixture.path))).data()!;
    const data: DocumentData = { ...existing, updatedAt: serverTimestamp() };
    if (fixture.name === "cards") data.revision = existing.revision + 1;
    await assertSucceeds(setDoc(doc(db, fixture.path), data));
  });
  it.each(["visitor-two", null])("denies another or unauthenticated visitor (%s)", async (uid) => {
    await seed(fixture.path, fixture.data());
    const db = visitor(uid);
    await assertFails(getDoc(doc(db, fixture.path)));
    await assertFails(setDoc(doc(db, fixture.path), fixture.data()));
    await assertFails(deleteDoc(doc(db, fixture.path)));
    if (fixture.name !== "profile") await assertFails(getDocs(collection(db, "demos", UID, fixture.name)));
    await assertFails(setDoc(doc(db, fixture.path.replace(UID, "visitor-three")), fixture.data()));
  });
  it("denies extra fields", async () => {
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), unexpected: true }));
  });
  it("denies wrong field types", async () => {
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), ...fixture.wrong }));
    if (fixture.name === "cards") {
      for (const field of ["fsrsState", "stability", "difficulty", "lapses", "scheduledDays", "firstReviewedAt"]) {
        await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), [field]: "wrong-type" }));
      }
    }
  });
  it("denies an omitted field", async () => {
    const data = fixture.data();
    delete data.updatedAt;
    await assertFails(setDoc(doc(visitor(), fixture.path), data));
  });
  it("denies a forged updatedAt", async () => {
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), updatedAt: old() }));
  });
  it("denies writes within one second", async () => {
    // A future timestamp guarantees a sub-second interval even on a slow CI host.
    await seed(fixture.path, fixture.data());
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), fixture.path), { updatedAt: Timestamp.fromMillis(Date.now() + 60_000) }, { merge: true });
    });
    const db = visitor();
    const data = (await getDoc(doc(db, fixture.path))).data()!;
    await assertFails(setDoc(doc(db, fixture.path), {
      ...data, updatedAt: serverTimestamp(), ...(fixture.name === "cards" ? { revision: data.revision + 1 } : {}),
    }));
  });
  it("lets the owner delete for reset", async () => {
    await seed(fixture.path, fixture.data());
    await assertSucceeds(deleteDoc(doc(visitor(), fixture.path)));
  });
});

describe("fixed paths and bounded state", () => {
  it.each(fixtures.filter((fixture) => fixture.name !== "profile"))("denies an unlisted pack in $name", async (fixture) => {
    const data = fixture.data();
    if (fixture.name === "cards") data.packId = "unknown-pack";
    await assertFails(setDoc(doc(visitor(), fixture.path.replace(PACK, "unknown-pack")), data));
  });
  it.each(fixtures.filter((fixture) => fixture.name !== "profile"))("denies a malformed ID in $name", async (fixture) => {
    const path = fixture.path.slice(0, fixture.path.lastIndexOf("/") + 1) + "Malformed_ID";
    await assertFails(setDoc(doc(visitor(), path), fixture.data()));
  });
  it("binds card fields to the path", async () => {
    const fixture = fixtures[1];
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), cardId: "card-002" }));
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), packId: "staining-microscopy" }));
  });
  it("denies unbounded card and question IDs", async () => {
    for (const fixture of [fixtures[1], fixtures[2]]) {
      const data = fixture.data();
      if (fixture.name === "cards") data.cardId = "card-101";
      await assertFails(setDoc(doc(visitor(), fixture.path.replace("001", "101")), data));
    }
  });
  it("requires the next card revision", async () => {
    const fixture = fixtures[1];
    await seed(fixture.path, fixture.data());
    const ref = doc(visitor(), fixture.path);
    const saved = (await getDoc(ref)).data()!;
    await assertFails(setDoc(ref, { ...saved, updatedAt: serverTimestamp() }));
  });
  it("accepts a first review at request time", async () => {
    const fixture = fixtures[1];
    await assertSucceeds(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), firstReviewedAt: serverTimestamp() }));
  });
  it("accepts legacy cards without firstReviewedAt and their timestamp migration", async () => {
    const fixture = fixtures[1];
    const legacy = fixture.data();
    delete legacy.firstReviewedAt;
    await seed(fixture.path, legacy);
    const ref = doc(visitor(), fixture.path);
    await assertSucceeds(getDoc(ref));
    const saved = (await getDoc(ref)).data()!;
    await assertSucceeds(setDoc(ref, {
      ...saved, firstReviewedAt: serverTimestamp(),
      revision: saved.revision + 1, updatedAt: serverTimestamp(),
    }));
  });
  it("requires firstReviewedAt on new writes", async () => {
    const fixture = fixtures[1];
    const data = fixture.data();
    delete data.firstReviewedAt;
    await assertFails(setDoc(doc(visitor(), fixture.path), data));
    await seed(fixture.path, data);
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...data, revision: data.revision + 1 }));
  });
  it("denies a client timestamp in the past for a first review", async () => {
    const fixture = fixtures[1];
    await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), firstReviewedAt: old() }));
  });
  it("denies firstReviewedAt after request time or null", async () => {
    const fixture = fixtures[1];
    for (const firstReviewedAt of [Timestamp.fromMillis(Date.now() + 60_000), null]) {
      await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), firstReviewedAt }));
    }
  });
  it("denies changing an existing firstReviewedAt", async () => {
    const fixture = fixtures[1];
    await seed(fixture.path, fixture.data());
    const ref = doc(visitor(), fixture.path);
    const saved = (await getDoc(ref)).data()!;
    for (const firstReviewedAt of [old(), serverTimestamp()]) {
      await assertFails(setDoc(ref, {
        ...saved, firstReviewedAt, revision: saved.revision + 1, updatedAt: serverTimestamp(),
      }));
    }
  });
  it("allows preserving an existing firstReviewedAt", async () => {
    const fixture = fixtures[1];
    await seed(fixture.path, { ...fixture.data(), firstReviewedAt: old() });
    const ref = doc(visitor(), fixture.path);
    const saved = (await getDoc(ref)).data()!;
    await assertSucceeds(setDoc(ref, {
      ...saved, revision: saved.revision + 1, updatedAt: serverTimestamp(),
    }));
  });
  it("denies migrating a legacy firstReviewedAt from the client clock", async () => {
    const fixture = fixtures[1];
    const legacy = fixture.data();
    delete legacy.firstReviewedAt;
    await seed(fixture.path, legacy);
    const ref = doc(visitor(), fixture.path);
    const saved = (await getDoc(ref)).data()!;
    for (const firstReviewedAt of [old(), Timestamp.fromMillis(Date.now() + 60_000)]) {
      await assertFails(setDoc(ref, {
        ...saved, firstReviewedAt, revision: saved.revision + 1, updatedAt: serverTimestamp(),
      }));
    }
  });
  it("denies out-of-range FSRS values", async () => {
    const fixture = fixtures[1];
    for (const change of [
      { fsrsState: -1 }, { fsrsState: 4 }, { fsrsState: 1.5 }, { stability: -1 },
      { lapses: -1 }, { lapses: 0.5 }, { scheduledDays: -1 }, { scheduledDays: 0.5 },
    ]) {
      await assertFails(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), ...change }));
    }
  });
  it("accepts both session kinds and denies other kinds", async () => {
    const fixture = fixtures[3];
    await assertSucceeds(setDoc(doc(visitor(), fixture.path.replace("practice", "timed")), fixture.data()));
    await assertFails(setDoc(doc(visitor(), fixture.path.replace("practice", "other")), fixture.data()));
  });
  it("accepts the session byte limit and denies ASCII and multibyte overflow", async () => {
    const fixture = fixtures[3];
    await assertSucceeds(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), state: "x".repeat(20 * 1024) }));
    for (const state of ["x".repeat(20 * 1024 + 1), "€".repeat(7_000)]) {
      await assertFails(setDoc(doc(visitor(), fixture.path.replace("practice", "timed")), { ...fixture.data(), state }));
    }
  });
  it("accepts a null exam date and denies invalid date formats", async () => {
    const fixture = fixtures[4];
    await assertSucceeds(setDoc(doc(visitor(), fixture.path), { ...fixture.data(), examDate: null }));
    await assertFails(setDoc(doc(visitor(), fixture.path.replace(PACK, "staining-microscopy")), { ...fixture.data(), examDate: "tomorrow" }));
  });
  it.each(["other/doc", `demos/${UID}/unknown/doc`, `demos/${UID}/cards/${PACK}__card-001/nested/doc`])("denies every unowned path: %s", async (path) => {
    const db = visitor();
    await assertFails(setDoc(doc(db, path), { updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db, path)));
  });
});
