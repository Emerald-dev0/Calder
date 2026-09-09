import Image from "next/image";
import Link from "next/link";
import { configuredProviders } from "@calder/auth";
import { MagicLinkForm } from "./magic-link-form";

const LABELS = { google: "Continue with Google", github: "Continue with GitHub" } as const;

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const providers = configuredProviders();
  const linkError = searchParams?.error === "link";
  const devLogin = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "true";
  return (
    <div className="login-split">
      <div className="login-art" aria-hidden="true">
        <p className="login-art-brand">Calder</p>
        <h2 className="login-art-headline">Every send, on the record.</h2>
        <p className="login-art-sub">
          Sign in to watch your mail move: queued, sent, delivered, every event kept where you can
          prove it.
        </p>
        <div className="login-art-stage">
          <Image
            src="/illustrations/hero-courier-cutout.webp"
            alt=""
            width={1536}
            height={1024}
            priority
            className="login-courier"
          />
          <Image
            src="/illustrations/onboarding-arrival-letter.webp"
            alt=""
            width={462}
            height={133}
            className="login-envelope"
          />
        </div>
        <p className="login-art-caption">Carried, not wished.</p>
      </div>

      <div className="login-form-wrap">
        <div className="login-form">
          <h1>Sign in</h1>
          <p className="login-form-lede">
            One account for every organization you belong to, including Calder itself.
          </p>
          {linkError && (
            <p className="login-error">
              That link is invalid, expired, or already used. Request a fresh one below.
            </p>
          )}
          <MagicLinkForm />
          {providers.length > 0 && (
            <>
              <div className="login-divider">or</div>
              <div className="login-oauth">
                {providers.map((p) => (
                  <Link key={p} href={`/api/auth/${p}`} className="login-oauth-btn">
                    {LABELS[p]}
                  </Link>
                ))}
              </div>
            </>
          )}
          {providers.length === 0 && (
            <div className="login-empty">
              <p>OAuth isn&rsquo;t configured yet</p>
              <p>
                Set <span className="mono">GOOGLE_CLIENT_ID</span> /{" "}
                <span className="mono">GOOGLE_CLIENT_SECRET</span> or the GitHub equivalents, then
                restart the dashboard. Callback URL ends in{" "}
                <span className="mono">/api/auth/callback/&lt;provider&gt;</span>.
              </p>
            </div>
          )}
          <p className="login-footnote">
            New here? Signing in creates your account automatically, founders listed in{" "}
            <span className="mono">FOUNDER_EMAILS</span> are granted the Calder org on first login.
          </p>
          {devLogin && (
            <form
              action="/api/auth/dev-login"
              method="POST"
              style={{
                marginTop: 20,
                border: "1px dashed #CA8A04",
                borderRadius: 12,
                padding: 16,
                background: "#FFFBEB",
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>
                Dev login (local only, disabled in production)
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 40,
                    border: "1px solid #D4D4D4",
                    borderRadius: 8,
                    padding: "0 12px",
                    fontSize: 14,
                  }}
                />
                <button
                  type="submit"
                  style={{
                    background: "#0B0C0E",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "0 16px",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Enter
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
