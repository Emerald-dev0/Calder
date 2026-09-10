"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { OtpInput } from "../../components/otp-input";

interface LoginFormProps {
  providers: readonly ("google" | "github")[];
  initialError?: string;
  devLogin?: boolean;
}

const LABELS = { google: "Continue with Google", github: "Continue with GitHub" } as const;

export function LoginForm({ providers, initialError, devLogin }: LoginFormProps) {
  const [mode, setMode] = useState<
    "login" | "verify-code" | "forgot-email" | "forgot-code" | "forgot-new-password" | "magic-link"
  >("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError === "link" ? "That link is invalid, expired, or already used." : null
  );
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Resend countdown timer
  const [resendSeconds, setResendSeconds] = useState(60);

  useEffect(() => {
    if (!["verify-code", "forgot-code"].includes(mode) || resendSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, resendSeconds]);

  // Handle standard password login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Invalid email or password.");
      }

      if (data.needsVerification) {
        // Account unverified: prompt for OTP verification code
        setMode("verify-code");
        setResendSeconds(60);
        setCode("");
        return;
      }

      // Logged in: redirect to dashboard
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  // Handle OTP verification for unverified login
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const finalCode = (codeToVerify || code).trim();
    if (finalCode.length !== 6) {
      setError("Enter the 6-digit verification code.");
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

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setBusy(false);
    }
  };

  // Handle forgot password step 1: submit email
  const handleForgotEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/email-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "reset" }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not send reset code.");
      }

      setMode("forgot-code");
      setResendSeconds(60);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset code.");
    } finally {
      setBusy(false);
    }
  };

  // Handle forgot password step 2: advance to new password
  const handleForgotCodeSubmit = async (codeToCheck?: string) => {
    const finalCode = (codeToCheck || code).trim();
    if (finalCode.length !== 6) {
      setError("Enter the 6-digit reset code.");
      return;
    }
    setError(null);
    setMode("forgot-new-password");
  };

  // Handle forgot password step 3: reset password
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Password reset failed.");
      }

      setSuccessNotice("Password updated successfully. You can now sign in.");
      setPassword("");
      setNewPassword("");
      setCode("");
      setMode("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setBusy(false);
    }
  };

  // Resend code helper
  const handleResend = async (purpose: "verification" | "reset") => {
    if (resendSeconds > 0 || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/email-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not resend code.");
      }

      setResendSeconds(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setBusy(false);
    }
  };

  // Magic link request handler
  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSuccessNotice("Check your inbox — we sent a one-time sign-in link.");
      } else {
        setError("Failed to send sign-in link. Please check your address.");
      }
    } catch {
      setError("Failed to send sign-in link.");
    } finally {
      setBusy(false);
    }
  };

  // 1. UNVERIFIED ACCOUNT CODE STEP
  if (mode === "verify-code") {
    return (
      <div className="auth-step-wrap">
        <h1>Verify your email</h1>
        <p className="login-form-lede">
          Your account is unverified. We sent a 6-digit code to{" "}
          <strong style={{ color: "var(--color-ink)" }}>{email}</strong>.
        </p>

        {error && <p className="login-error">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleVerifyOtp();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(fullCode) => void handleVerifyOtp(fullCode)}
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
                onClick={() => void handleResend("verification")}
                disabled={busy}
                className="resend-btn"
              >
                Resend code
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className="resend-btn"
              style={{ color: "var(--color-muted)" }}
            >
              Back to sign in
            </button>
          </div>
        </form>
      </div>
    );
  }

  // 2. FORGOT PASSWORD: STEP 1 (EMAIL)
  if (mode === "forgot-email") {
    return (
      <div className="auth-step-wrap">
        <h1>Reset your password</h1>
        <p className="login-form-lede">
          Enter your account email and we&rsquo;ll send you a 6-digit reset code.
        </p>

        {error && <p className="login-error">{error}</p>}

        <form onSubmit={handleForgotEmailSubmit} className="auth-form-fields">
          <div className="auth-field">
            <label htmlFor="forgot-email-input" className="auth-label">
              Account email
            </label>
            <input
              id="forgot-email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="auth-input"
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="auth-btn-primary"
            style={{ marginTop: 8 }}
          >
            {busy ? "Sending code..." : "Send reset code"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className="auth-link-btn"
            style={{ marginTop: 12 }}
          >
            ← Back to sign in
          </button>
        </form>
      </div>
    );
  }

  // 3. FORGOT PASSWORD: STEP 2 (CODE)
  if (mode === "forgot-code") {
    return (
      <div className="auth-step-wrap">
        <h1>Enter reset code</h1>
        <p className="login-form-lede">
          We sent a 6-digit password reset code to{" "}
          <strong style={{ color: "var(--color-ink)" }}>{email}</strong>.
        </p>

        {error && <p className="login-error">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleForgotCodeSubmit();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(fullCode) => void handleForgotCodeSubmit(fullCode)}
            disabled={busy}
          />

          <button type="submit" disabled={busy || code.length !== 6} className="auth-btn-primary">
            Continue →
          </button>

          <div className="resend-row">
            {resendSeconds > 0 ? (
              <span>Resend code in {resendSeconds}s</span>
            ) : (
              <button
                type="button"
                onClick={() => void handleResend("reset")}
                disabled={busy}
                className="resend-btn"
              >
                Resend code
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode("forgot-email");
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

  // 4. FORGOT PASSWORD: STEP 3 (NEW PASSWORD)
  if (mode === "forgot-new-password") {
    return (
      <div className="auth-step-wrap">
        <h1>Create new password</h1>
        <p className="login-form-lede">
          Set a fresh, secure password for{" "}
          <strong style={{ color: "var(--color-ink)" }}>{email}</strong>.
        </p>

        {error && <p className="login-error">{error}</p>}

        <form onSubmit={handleResetPasswordSubmit} className="auth-form-fields">
          <div className="auth-field">
            <label htmlFor="reset-new-password" className="auth-label">
              New password
            </label>
            <div className="password-input-wrap">
              <input
                id="reset-new-password"
                type={showPassword ? "text" : "password"}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 12 characters"
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
              {newPassword.length < 8 ? (
                <span>Minimum 8 characters required (12+ recommended).</span>
              ) : (
                <span style={{ color: "#16A34A" }}>
                  {newPassword.length >= 12
                    ? "Strong password"
                    : `${newPassword.length} characters`}
                </span>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="auth-btn-primary"
            style={{ marginTop: 8 }}
          >
            {busy ? "Updating password..." : "Update password & sign in"}
          </button>
        </form>
      </div>
    );
  }

  // 5. MAGIC LINK PASS-THROUGH
  if (mode === "magic-link") {
    return (
      <div className="auth-step-wrap">
        <h1>Email sign-in link</h1>
        <p className="login-form-lede">
          We&rsquo;ll email you a one-time sign-in link that works without a password.
        </p>

        {error && <p className="login-error">{error}</p>}
        {successNotice && (
          <p
            style={{
              fontSize: 13,
              color: "#16A34A",
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              padding: "10px 14px",
              margin: "0 0 16px",
            }}
          >
            {successNotice}
          </p>
        )}

        <form onSubmit={handleMagicLinkSubmit} className="auth-form-fields">
          <div className="auth-field">
            <label htmlFor="magic-email-input" className="auth-label">
              Work email
            </label>
            <input
              id="magic-email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="auth-input"
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="auth-btn-primary"
            style={{ marginTop: 8 }}
          >
            {busy ? "Sending link..." : "Email me a link"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className="auth-link-btn"
            style={{ marginTop: 12 }}
          >
            ← Sign in with password instead
          </button>
        </form>
      </div>
    );
  }

  // 6. DEFAULT SIGN-IN MODE (EMAIL + PASSWORD)
  return (
    <div className="auth-step-wrap">
      <h1>Sign in</h1>
      <p className="login-form-lede">
        One account for every organization you belong to, including Calder itself.
      </p>

      {successNotice && (
        <p
          style={{
            fontSize: 13,
            color: "#16A34A",
            background: "#F0FDF4",
            border: "1px solid #BBF7D0",
            borderRadius: 10,
            padding: "10px 14px",
            margin: "0 0 16px",
          }}
        >
          {successNotice}
        </p>
      )}

      {error && <p className="login-error">{error}</p>}

      <form onSubmit={handleLoginSubmit} className="auth-form-fields">
        <div className="auth-field">
          <label htmlFor="login-email" className="auth-label">
            Email
          </label>
          <input
            id="login-email"
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <label htmlFor="login-password" className="auth-label" style={{ margin: 0 }}>
              Password
            </label>
            <button
              type="button"
              onClick={() => {
                setMode("forgot-email");
                setError(null);
                setSuccessNotice(null);
              }}
              className="auth-link-btn"
              style={{ fontSize: 12 }}
            >
              Forgot password?
            </button>
          </div>
          <div className="password-input-wrap">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="auth-input"
              autoComplete="current-password"
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
        </div>

        <button type="submit" disabled={busy} className="auth-btn-primary" style={{ marginTop: 8 }}>
          {busy ? "Signing in..." : "Sign in"}
        </button>

        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button
            type="button"
            onClick={() => {
              setMode("magic-link");
              setError(null);
              setSuccessNotice(null);
            }}
            className="auth-link-btn"
            style={{ fontSize: 13 }}
          >
            Email me a sign-in link instead
          </button>
        </div>
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

      {providers.length === 0 && (
        <div className="login-empty">
          <p>OAuth isn&rsquo;t configured yet</p>
          <p>
            Set <span className="mono">GOOGLE_CLIENT_ID</span> /{" "}
            <span className="mono">GOOGLE_CLIENT_SECRET</span> or the GitHub equivalents in your
            environment.
          </p>
        </div>
      )}

      <p className="auth-footer-link">
        New here? <Link href="/signup">Create account</Link>
      </p>

      {devLogin && (
        <form
          action="/api/auth/dev-login"
          method="POST"
          style={{
            marginTop: 24,
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
  );
}
