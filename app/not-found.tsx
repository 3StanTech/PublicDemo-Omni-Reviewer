import Link from "next/link";
import { Compass } from "@phosphor-icons/react/dist/ssr";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { DEMO_TOPIC } from "@/components/topic-tabs";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell topics={[DEMO_TOPIC]} selectedTopicId={DEMO_TOPIC.id}>
      <EmptyState
        icon={<Compass weight="duotone" className="size-5" />}
        title="Page not found"
        description="This demo has a study desk and three sample packs. Head back to the desk to pick one."
        action={
          <Button nativeButton={false} render={<Link href="/" />}>
            Back to the study desk
          </Button>
        }
      />
    </AppShell>
  );
}
