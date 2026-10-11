import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-lg bg-muted/80 ring-1 ring-border/40",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
