import type { ViewsPayload } from "@/lib/serialize-view";
import type { FsrsCardState } from "@/lib/fsrs";
import type { CardedItem, TestMeItem, DurableCard, TestAttemptStats, CardRating } from "@/lib/types";

export type PackId = 'staining-microscopy' | 'prokaryotic-cell' | 'antimicrobial-drugs';
export type PackSummary = { id: PackId; name: string; sections: string[]; cardCount: number; testItemCount: number };
export type PackSource = { id: string; label: string; pages: { n: number; text: string }[] };
export type RecordedStep = { step: 'locked_in' | 'summary' | 'test_me' | 'carded'; ms: number };
export type RecordedAsk = { id: string; question: string; answer: string };
export type DemoPack = PackSummary & {
  views: ViewsPayload; cards: CardedItem[]; testItems: TestMeItem[];
  sources: PackSource[]; generation: RecordedStep[]; asks: RecordedAsk[];
  unsourcedPercent: number | null;
};
export type CardSchedule = Pick<DurableCard, 'dueAt' | 'intervalDays' | 'repetitions' | 'easeFactor' | 'lastReviewedAt' | 'revision'> & { fsrs: FsrsCardState | null; firstReviewedAt: Date | null };
export interface DemoApi {
  ready(): Promise<{ uid: string }>;                          // anonymous sign-in + App Check
  listPacks(): Promise<PackSummary[]>;
  loadPack(id: PackId): Promise<DemoPack>;
  getProgress(id: PackId): Promise<{ cards: Record<string, CardSchedule>; attempts: TestAttemptStats[]; examDate: string | null }>;
  reviewCard(id: PackId, cardId: string, rating: CardRating, expectedRevision: number): Promise<DurableCard & { fsrs: FsrsCardState; firstReviewedAt: Date | null }>;
  recordAttempts(id: PackId, answers: { itemId: string; correct: boolean }[]): Promise<TestAttemptStats[]>;
  getSession(id: PackId, kind: 'practice' | 'timed'): Promise<unknown | null>;
  saveSession(id: PackId, kind: 'practice' | 'timed', state: unknown | null): Promise<void>;
  setExamDate(id: PackId, date: string | null): Promise<string | null>;
  replayGeneration(id: PackId, onStep: (s: RecordedStep, index: number) => void, signal?: AbortSignal): Promise<void>;
  replayAsk(id: PackId, askId: string): AsyncIterable<string>;
  resetProgress(): Promise<void>;
}
