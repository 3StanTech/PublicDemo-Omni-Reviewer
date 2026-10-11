import { notFound } from "next/navigation";
import { Suspense } from "react";
import { preload } from "react-dom";

import { PackLoading, ReviewerWorkspaceLoader } from "@/components/reviewer-workspace";
import { PACK_IDS, packIdSchema } from "@/lib/demo/pack-schema";

export const dynamicParams = false;

export function generateStaticParams(): { packId: string }[] {
  return PACK_IDS.map((packId) => ({ packId }));
}

type PackPageProps = {
  params: Promise<{ packId: string }>;
};

export default async function PackPage({ params }: PackPageProps) {
  const parsed = packIdSchema.safeParse((await params).packId);
  if (!parsed.success) notFound();
  // Start the pack file with the JS, not after it boots. Matches lib/demo/packs.ts's plain same-origin
  // fetch (cors mode, same-origin credentials), so the browser reuses this response.
  preload(`/packs/${parsed.data}.json`, { as: "fetch", crossOrigin: "anonymous" });
  return (
    <Suspense fallback={<PackLoading />}>
      <ReviewerWorkspaceLoader packId={parsed.data} />
    </Suspense>
  );
}
