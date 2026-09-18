"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { OtpInput } from "../../components/otp-input";

interface SignupFormProps {
  providers: readonly ("google" | "github")[];
}

const LABELS = { google: "Continue with Google", github: "Continue with GitHub" } as const;

export function SignupForm({ providers }: SignupFormProps) {
  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resend timer: 60 seconds
  const [resendSeconds, setResendSeconds] = useState(60);

  useEffect(() => {
    if (step !== "code" || resendSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, resendSeconds]);

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create account.");
      }

      setStep("code");
      setResendSeconds(60);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifySubmit = async (codeToVerify?: string) => {
    const finalCode = (codeToVerify || code).trim();
    if (finalCode.length !== 6) {
      setError("Enter the complete 6-digit code.");
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/email-code/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: finalCode, purpose: "verification" }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Verification failed.");
      }

      // Success: session cookie is set, enter the app (founders land on
      // /control via the server-derived redirectTo, never a client check).
      window.location.href =
        typeof data.redirectTo === "string" && data.redirectTo.startsWith("/")
          ? data.redirectTo
          : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setBusy(false);
    }
  };

  const handleResendCode = async () => {
    if (resendSeconds > 0 || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/email-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "verification" }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to resend code.");
      }

      setResendSeconds(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "code") {
    return (
      <div className="auth-step-wrap">
        <h1>Check your email</h1>
        <p className="login-form-lede">
          We sent a 6-digit verification code to{" "}
          <strong style={{ color: "var(--color-ink)" }}>{email}</strong>.
        </p>

        {error && <p className="login-error">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleVerifySubmit();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(fullCode) => void handleVerifySubmit(fullCode)}
            disabled={busy}
          />

          <button type="submit" disabled={busy || code.length !== 6} className="auth-btn-primary">
            {busy ? "Verifying..." : "Verify & enter"}
          </button>

          <div className="resend-row">
            {resendSeconds > 0 ? (
              <span>Resend code in {resendSeconds}s</span>
            ) : (
              <button
                type="button"
                onClick={handleResendCode}
                disabled={busy}
                className="resend-btn"
              >
                Resend code
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError(null);
              }}
              className="resend-btn"
              style={{ color: "var(--color-muted)" }}
            >
              Change email
            </button>
          </div>
        </form>
      </div>
    );
  }

  const passwordLength = password.length;
  const isStrong = passwordLength >= 12;

  return (
    <div className="auth-step-wrap">
      <h1>Create your account</h1>
      <p className="login-form-lede">
        Start sending transactional communication with proof on the record.
      </p>

      {error && <p className="login-error">{error}</p>}

      <form onSubmit={handleSignupSubmit} className="auth-form-fields">
        <div className="auth-field">
          <label htmlFor="signup-name" className="auth-label">
            Your name <span style={{ color: "var(--color-muted)", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="signup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className="auth-input"
            autoComplete="name"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-email" className="auth-label">
            Work email
          </label>
          <input
            id="signup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="auth-input"
            autoComplete="email"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-password" className="auth-label">
            Password
          </label>
          <div className="password-input-wrap">
            <input
              id="signup-password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="auth-input"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="password-toggle-btn"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <div className="strength-hint">
            {passwordLength === 0 ? (
              <span>Strength hint: 12+ characters recommended.</span>
            ) : isStrong ? (
              <span style={{ color: "#16A34A", fontWeight: 500 }}>
                Strong password ({passwordLength} characters)
              </span>
            ) : (
              <span>
                {passwordLength} / 12 characters (minimum 8 required)
              </span>
            )}
          </div>
        </div>

        <button type="submit" disabled={busy} className="auth-btn-primary" style={{ marginTop: 8 }}>
          {busy ? "Creating account..." : "Continue with email"}
        </button>

        <p className="terms-note">
          By signing up, you agree to our terms and service policies. No credit card required.
        </p>
      </form>

      {providers.length > 0 && (
        <>
          <div className="login-divider">or continue with</div>
          <div className="login-oauth">
            {providers.map((p) => (
              <Link key={p} href={`/api/auth/${p}`} className="login-oauth-btn">
                {LABELS[p]}
              </Link>
            ))}
          </div>
        </>
      )}

      <p className="auth-footer-link">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
