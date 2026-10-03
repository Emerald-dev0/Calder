"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Route guard: users with an incomplete onboarding (unless explicitly paused
 * via "Save and exit") are redirected to /onboarding from dashboard pages.
 */
export function OnboardingGate({
  orgCount,
  incomplete = false,
}: {
  orgCount: number;
  incomplete?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (
      (incomplete || orgCount === 0) &&
      !pathname.startsWith("/onboarding") &&
      !pathname.startsWith("/settings")
    ) {
      router.replace("/onboarding");
    }
  }, [incomplete, orgCount, pathname, router]);
  return null;
}
