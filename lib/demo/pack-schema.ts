import { z } from "zod";
import type { DemoPack, PackSummary } from "./contract";

export const PACK_IDS = ["staining-microscopy", "prokaryotic-cell", "antimicrobial-drugs"] as const;
export const packIdSchema = z.enum(PACK_IDS);
const stableId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const text = z.string().min(1).max(500_000);
const count = z.number().int().min(0).max(100);
const kinds = ["locked_in", "summary", "test_me", "carded"] as const;

export const packSummarySchema = z.strictObject({
  id: packIdSchema,
  name: z.string().min(1).max(120),
  sections: z.array(z.string().regex(/^\d+\.\d+$/)).min(1).max(3),
  cardCount: count,
  testItemCount: count,
}) satisfies z.ZodType<PackSummary>;

const cardSchema = z.strictObject({
  id: stableId,
  front: z.string().min(1).max(20_000),
  back: z.string().min(1).max(20_000),
  kind: z.enum(["basic", "cloze"]).optional(),
});
const testItemSchema = z.strictObject({
  id: stableId,
  question: z.string().min(1).max(20_000),
  choices: z.array(z.string().min(1).max(2_000)).min(2).max(8).optional(),
  answer: z.string().min(1).max(20_000),
  explanation: z.string().max(20_000),
}).refine((item) => !item.choices || item.choices.includes(item.answer), {
  message: "The answer must match a choice.",
});
const nonnegative = z.number().int().nonnegative();
const groundingSchema = z.strictObject({
  total: nonnegative,
  cited: nonnegative,
  lexicalSupported: nonnegative,
  verifiedSupported: nonnegative,
  unsourced: nonnegative,
  truncated: z.boolean(),
  verifierFailed: z.boolean(),
  unchecked: nonnegative.optional(),
  uncheckedKeys: z.array(z.string().max(16)).max(500).optional(),
  termFlagged: nonnegative.optional(),
  termFlags: z.record(z.string().max(16), z.array(z.string().max(200))).optional(),
});
const documentMetaSchema = z.strictObject({
  citationSources: z.array(z.strictObject({
    index: z.number().int().min(1).max(99),
    sourceId: stableId,
    filename: z.string().min(1).max(200),
    hasPages: z.boolean(),
  })).min(1).max(3),
  grounding: groundingSchema.optional(),
});

// Empty identity/date fields satisfy the ported view type without publishing
// database identities or the original run timestamps.
const viewSchema = z.strictObject({
  id: stableId,
  reviewerId: z.literal(""),
  kind: z.enum(kinds),
  content: text,
  contentJson: z.union([documentMetaSchema, z.array(cardSchema), z.array(testItemSchema)]),
  generatedAt: z.literal(""),
  updatedAt: z.literal(""),
  contentRevision: z.number().int().min(1),
  annotationRevision: z.number().int().min(1),
  revision: z.number().int().min(1),
  isEdited: z.literal(false),
  isPinned: z.literal(false),
  stale: z.literal(false).optional(),
});

export const demoPackSchema: z.ZodType<DemoPack> = z.strictObject({
  ...packSummarySchema.shape,
  views: z.strictObject({
    locked_in: viewSchema,
    summary: viewSchema,
    test_me: viewSchema,
    carded: viewSchema,
    currentGenerationRunId: z.null().optional(),
    staleKinds: z.array(z.enum(kinds)).length(0).optional(),
  }),
  cards: z.array(cardSchema).min(1).max(100),
  testItems: z.array(testItemSchema).min(1).max(100),
  sources: z.array(z.strictObject({
    id: stableId,
    label: z.string().min(1).max(200),
    pages: z.array(z.strictObject({ n: nonnegative, text })).min(1).max(1_000),
  })).min(1).max(3),
  generation: z.array(z.strictObject({
    step: z.enum(kinds), ms: z.number().int().nonnegative().max(86_400_000),
  })).length(4),
  asks: z.array(z.strictObject({
    id: stableId, question: z.string().min(1).max(2_000), answer: text,
  })).length(2),
  unsourcedPercent: z.number().min(0).max(100).nullable(),
}).superRefine((pack, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (pack.cardCount !== pack.cards.length || pack.testItemCount !== pack.testItems.length) {
    issue("Pack counts must match the stored items.");
  }
  for (const entries of [pack.cards, pack.testItems, pack.sources, pack.asks]) {
    if (new Set(entries.map((item) => item.id)).size !== entries.length) issue("IDs must be unique within each collection.");
  }
  const sourceIds = new Set(pack.sources.map((source) => source.id));
  kinds.forEach((kind, index) => {
    if (pack.generation[index]?.step !== kind) issue("Generation steps must use the recorded mode order.");
    const view = pack.views[kind];
    if (view.kind !== kind) issue("Each view must match its mode.");
    if (kind === "locked_in" || kind === "summary") {
      const meta = documentMetaSchema.safeParse(view.contentJson);
      if (!meta.success) issue("Reading views must carry citation metadata.");
      else {
        const indexes = new Set<number>();
        for (const ref of meta.data.citationSources) {
          if (!sourceIds.has(ref.sourceId) || indexes.has(ref.index)) issue("Citation sources must resolve uniquely inside the pack.");
          indexes.add(ref.index);
        }
      }
    } else if (JSON.stringify(view.contentJson) !== JSON.stringify(kind === "carded" ? pack.cards : pack.testItems)) {
      issue("Practice view JSON must match the pack items.");
    }
  });
  for (const source of pack.sources) {
    if (new Set(source.pages.map((page) => page.n)).size !== source.pages.length) issue("Page numbers must be unique within each source.");
  }
});

// The manifest is a JSON array of PackSummary, in display order.
export const manifestSchema = z.array(packSummarySchema).max(3).refine(
  (packs) => new Set(packs.map((pack) => pack.id)).size === packs.length,
  { message: "Manifest pack IDs must be unique." },
);
