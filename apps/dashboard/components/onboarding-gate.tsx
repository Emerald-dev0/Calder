"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Brand-new users (no organization yet) belong in onboarding, not staring
 * at an empty dashboard. Settings stays reachable so Workspace creation
 * remains an alternate path. Existing members are never redirected.
 */
export function OnboardingGate({ orgCount }: { orgCount: number }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (
      orgCount === 0 &&
      !pathname.startsWith("/onboarding") &&
      !pathname.startsWith("/settings")
    ) {
      router.replace("/onboarding");
    }
  }, [orgCount, pathname, router]);
  return null;
}
