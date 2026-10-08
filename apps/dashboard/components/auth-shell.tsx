import * as React from "react";
import Link from "next/link";
import { CalderLockup } from "@calder/ui";

export function ThemedLockup({ size = 22 }: { size?: number }) {
  return (
    <>
      <CalderLockup tone="ink" size={size} className="auth-lockup-light" />
      <CalderLockup tone="paper" size={size} className="auth-lockup-dark" />
    </>
  );
}

export function AuthShell({
  children,
  switchHref,
  switchLabel,
}: {
  children: React.ReactNode;
  switchHref?: string;
  switchLabel?: string;
}) {
  return (
    <div className="auth-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="auth-glow" aria-hidden="true" />
      <header className="auth-topbar">
        <Link href="/login" aria-label="Calder home">
          <ThemedLockup size={22} />
        </Link>
        {switchHref && switchLabel && <Link href={switchHref}>{switchLabel}</Link>}
      </header>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
      <footer className="auth-foot">
        <span className="auth-foot-tag">Every send, on the record.</span>
      </footer>
    </div>
  );
}
