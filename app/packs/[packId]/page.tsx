import { notFound } from "next/navigation";
import { Suspense } from "react";

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
  return (
    <Suspense fallback={<PackLoading />}>
      <ReviewerWorkspaceLoader packId={parsed.data} />
    </Suspense>
  );
}
