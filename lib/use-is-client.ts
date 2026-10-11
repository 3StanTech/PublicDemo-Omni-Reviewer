"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** True only after client hydration; false on server and first client paint. */
export function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
