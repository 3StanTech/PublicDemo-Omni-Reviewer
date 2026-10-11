import {
  collection, doc, getDoc, getDocs, increment, query, runTransaction, serverTimestamp,
  Timestamp, where, writeBatch,
  type DocumentData, type DocumentReference, type Firestore,
} from "firebase/firestore";
import { isCalendarDate } from "@/lib/date-validation";
import { fsrsNext, type FsrsCardState } from "@/lib/fsrs";
import type { TestAttemptStats } from "@/lib/types";
import type { CardSchedule, DemoApi } from "./contract";
import { readyFirebase } from "./firebase";
import { packIdSchema } from "./pack-schema";
import { loadPack } from "./packs";

type SessionKind = "practice" | "timed";
const SESSION_BYTES = 20 * 1024;
const DAY_MS = 86_400_000;

// Reset and local writes share a queue; a pending save cannot resurrect reset data.
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutations.then(operation);
  mutations = next.catch(() => undefined);
  return next;
}

function sessionKind(kind: SessionKind): SessionKind {
  if (kind !== "practice" && kind !== "timed") throw new Error("Unknown study session kind.");
  return kind;
}

function date(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

function schedule(data: DocumentData): CardSchedule {
  const dueAt = date(data.dueAt);
  if (!dueAt) throw new Error("Saved card schedule has no due date.");
  const lastReviewedAt = date(data.lastReviewedAt);
  const firstReviewedAt = date(data.firstReviewedAt) ?? lastReviewedAt;
  const fsrs: FsrsCardState | null = !lastReviewedAt || data.fsrsState == null || data.fsrsState === 0 ? null : {
    state: data.fsrsState, stability: data.stability, difficulty: data.difficulty,
    reps: data.repetitions, lapses: data.lapses, scheduledDays: data.scheduledDays,
    lastReview: lastReviewedAt, due: dueAt,
  };
  return {
    dueAt, intervalDays: data.intervalDays, repetitions: data.repetitions,
    easeFactor: data.easeFactor, lastReviewedAt, firstReviewedAt, revision: data.revision, fsrs,
  };
}

function attempt(itemId: string, data: DocumentData): TestAttemptStats {
  return { itemId, attempts: data.attempts, misses: data.misses, lastAttemptedAt: date(data.lastAttemptedAt) };
}

async function waitForWriteWindow(data: DocumentData | undefined): Promise<void> {
  const updated = date(data?.updatedAt);
  if (!updated) return;
  const delay = Math.max(0, updated.getTime() + 1_100 - Date.now());
  if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

export const getProgress: DemoApi["getProgress"] = async (id) => {
  packIdSchema.parse(id);
  const [{ uid, db }, pack] = await Promise.all([readyFirebase(), loadPack(id)]);
  const [cards, attempts, settings] = await Promise.all([
    getDocs(query(collection(db, "demos", uid, "cards"), where("packId", "==", id))),
    // Attempts carry their pack identity in the deterministic document ID.
    getDocs(collection(db, "demos", uid, "attempts")),
    getDoc(doc(db, "demos", uid, "packs", id)),
  ]);
  const validCards = new Set(pack.cards.map((item) => item.id));
  const validItems = new Set(pack.testItems.map((item) => item.id));
  const result: Awaited<ReturnType<DemoApi["getProgress"]>> = {
    cards: {}, attempts: [], examDate: settings.data()?.examDate ?? null,
  };
  cards.forEach((snapshot) => {
    const data = snapshot.data();
    if (validCards.has(data.cardId) && snapshot.id === `${id}__${data.cardId}`) result.cards[data.cardId] = schedule(data);
  });
  attempts.forEach((snapshot) => {
    if (!snapshot.id.startsWith(`${id}__`)) return;
    const itemId = snapshot.id.slice(id.length + 2);
    if (validItems.has(itemId)) result.attempts.push(attempt(itemId, snapshot.data()));
  });
  return result;
};

export const reviewCard: DemoApi["reviewCard"] = (id, cardId, rating, expectedRevision) => mutate(async () => {
  packIdSchema.parse(id);
  if (rating !== "again" && rating !== "good") throw new Error("Unknown card rating.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid card revision.");
  const [{ uid, db }, pack] = await Promise.all([readyFirebase(), loadPack(id)]);
  const card = pack.cards.find((item) => item.id === cardId);
  if (!card) throw new Error("That card is not in this sample pack.");
  const ref = doc(db, "demos", uid, "cards", `${id}__${cardId}`);
  const settingsRef = doc(db, "demos", uid, "packs", id);
  return runTransaction(db, async (transaction) => {
    const [snapshot, settings] = await Promise.all([transaction.get(ref), transaction.get(settingsRef)]);
    const data = snapshot.data();
    // Unsaved static cards start at revision 0 in the study UI.
    const revision = data?.revision ?? 0;
    if (revision !== expectedRevision) throw new Error("This card changed elsewhere. Reload before reviewing.");
    await waitForWriteWindow(data);
    const previous = data ? schedule(data) : null;
    const reviewedAt = new Date();
    const next = fsrsNext(previous?.fsrs ?? null, rating, reviewedAt, settings.data()?.examDate ?? null);
    const saved = {
      dueAt: next.due,
      intervalDays: Math.max(0, Math.round((next.due.getTime() - reviewedAt.getTime()) / DAY_MS)),
      repetitions: next.reps, easeFactor: previous?.easeFactor ?? 25,
      lastReviewedAt: reviewedAt, revision: revision + 1, fsrs: next,
      firstReviewedAt: previous?.firstReviewedAt ?? reviewedAt,
    } satisfies CardSchedule;
    const { fsrs, ...fields } = saved;
    transaction.set(ref, {
      packId: id, cardId, ...fields,
      fsrsState: fsrs.state, stability: fsrs.stability, difficulty: fsrs.difficulty,
      lapses: fsrs.lapses, scheduledDays: fsrs.scheduledDays,
      updatedAt: serverTimestamp(),
    });
    return { ...card, ...saved, sourceKey: card.id, isEdited: false, isPinned: false };
  });
});

export const recordAttempts: DemoApi["recordAttempts"] = (id, answers) => mutate(async () => {
  packIdSchema.parse(id);
  const [{ uid, db }, pack] = await Promise.all([readyFirebase(), loadPack(id)]);
  const validItems = new Set(pack.testItems.map((item) => item.id));
  const counts = new Map<string, { attempts: number; misses: number }>();
  for (const answer of answers) {
    if (!validItems.has(answer.itemId) || typeof answer.correct !== "boolean") throw new Error("Unknown sample test answer.");
    const count = counts.get(answer.itemId) ?? { attempts: 0, misses: 0 };
    count.attempts++;
    if (!answer.correct) count.misses++;
    counts.set(answer.itemId, count);
  }
  const refs = [...counts.keys()].map((itemId) => doc(db, "demos", uid, "attempts", `${id}__${itemId}`));
  const existing = await Promise.all(refs.map((ref) => getDoc(ref)));
  await Promise.all(existing.map((snapshot) => waitForWriteWindow(snapshot.data())));
  const batch = writeBatch(db);
  for (const ref of refs) {
    const itemId = ref.id.slice(id.length + 2);
    const count = counts.get(itemId)!;
    batch.set(ref, {
      attempts: increment(count.attempts), misses: increment(count.misses),
      lastAttemptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });
  }
  if (refs.length) await batch.commit();
  const saved = await getDocs(collection(db, "demos", uid, "attempts"));
  return saved.docs.filter((snapshot) => snapshot.id.startsWith(`${id}__`) && validItems.has(snapshot.id.slice(id.length + 2)))
    .map((snapshot) => attempt(snapshot.id.slice(id.length + 2), snapshot.data()));
});

export const getSession: DemoApi["getSession"] = async (id, kind) => {
  packIdSchema.parse(id);
  sessionKind(kind);
  const { uid, db } = await readyFirebase();
  const snapshot = await getDoc(doc(db, "demos", uid, "sessions", `${id}__${kind}`));
  return snapshot.exists() ? JSON.parse(snapshot.data().state) : null;
};

export const saveSession: DemoApi["saveSession"] = (id, kind, state) => mutate(async () => {
  packIdSchema.parse(id);
  sessionKind(kind);
  const serialized = state === null ? null : JSON.stringify(state);
  if (serialized === undefined || (serialized !== null && new TextEncoder().encode(serialized).length > SESSION_BYTES)) {
    throw new Error("Study session must be JSON no larger than 20 KB.");
  }
  const { uid, db } = await readyFirebase();
  const ref = doc(db, "demos", uid, "sessions", `${id}__${kind}`);
  const batch = writeBatch(db);
  if (serialized === null) batch.delete(ref);
  else {
    await waitForWriteWindow((await getDoc(ref)).data());
    batch.set(ref, { state: serialized, updatedAt: serverTimestamp() });
  }
  await batch.commit();
});

export const setExamDate: DemoApi["setExamDate"] = (id, examDate) => mutate(async () => {
  packIdSchema.parse(id);
  if (examDate !== null && !isCalendarDate(examDate)) throw new Error("Enter a valid exam date (YYYY-MM-DD).");
  const { uid, db } = await readyFirebase();
  const ref = doc(db, "demos", uid, "packs", id);
  await waitForWriteWindow((await getDoc(ref)).data());
  const batch = writeBatch(db);
  batch.set(ref, { examDate, lastOpenedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
  return examDate;
});

async function deleteBatches(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += 500) {
    const batch = writeBatch(db);
    refs.slice(offset, offset + 500).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export const resetProgress: DemoApi["resetProgress"] = () => mutate(async () => {
  const { uid, db } = await readyFirebase();
  const collections = await Promise.all(["cards", "attempts", "sessions", "packs"]
    .map((name) => getDocs(collection(db, "demos", uid, name))));
  await deleteBatches(db, collections.flatMap((snapshot) => snapshot.docs.map((entry) => entry.ref)));
  await deleteBatches(db, [doc(db, "demos", uid)]);
});
