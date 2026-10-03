"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalderLockup } from "@calder/ui";
import {
  checkUsernameAvailability,
  saveOnboardingStep,
  saveAndExitOnboarding,
  saveProfile,
  saveOrgAndProjectStep,
  saveSendingSetupStep,
  sendFirstEmail,
  getEmailStatus,
  addDomain,
  checkDomainDns,
  completeOnboarding,
  type DnsRecord,
} from "../../(app)/onboarding/actions";
import {
  ONBOARDING_PHASES,
  ONBOARDING_TOTAL_STEPS,
  PROFILE_ROLES,
  SENDING_MODE_OPTIONS,
  getPhaseProgress,
  isValidSlug,
  isValidUsername,
  slugify,
  type OnboardingStepNumber,
  type SendingSetupMode,
} from "../../../lib/onboarding";

export interface OnboardingWizardProps {
  userEmail: string;
  initialStep: OnboardingStepNumber;
  initialNotice: string | null;
  initialProfile: {
    name: string;
    username: string;
    role: string;
  };
  initialOrg: {
    id: string;
    name: string;
    slug: string;
  } | null;
  initialProject: {
    id: string;
    name: string;
    slug: string;
  } | null;
  initialDomain: {
    id: string;
    domain: string;
    status: "pending" | "verified";
    records: DnsRecord[];
  } | null;
  initialTransports: Array<{
    id: string;
    type: string;
    label: string;
    status: string;
    isDefault: boolean;
    dailyCap: number | null;
  }>;
  initialEmail: {
    id: string;
    to: string;
    subject: string;
    text: string;
    status: string;
  } | null;
}

const EASE_OUT_EDITORIAL: [number, number, number, number] = [0.22, 1, 0.36, 1];

type UsernameCheckState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "available"; message: string }
  | { status: "invalid" | "taken"; message: string };

const DELIVERY_STEPS = [
  {
    key: "queued",
    code: "01",
    label: "Queued",
    detail: "Accepted by API & persisted to delivery queue",
  },
  {
    key: "sent",
    code: "02",
    label: "Sent",
    detail: "Dispatched through project transport pipeline",
  },
  {
    key: "delivered",
    code: "03",
    label: "Delivered",
    detail: "Confirmed at recipient destination",
  },
] as const;

function deliveryStepState(
  currentStatus: string | null,
  stepKey: "queued" | "sent" | "delivered"
): "pending" | "active" | "complete" {
  if (!currentStatus) return "pending";
  const order = ["queued", "sent", "delivered"];
  const normalized = currentStatus === "sending" ? "queued" : currentStatus;
  const currentIdx = order.indexOf(normalized);
  const stepIdx = order.indexOf(stepKey);
  if (currentIdx === -1) return "pending";
  if (stepIdx < currentIdx) return "complete";
  if (stepIdx === currentIdx) {
    return normalized === "delivered" ? "complete" : "active";
  }
  return "pending";
}

export function OnboardingWizard({
  userEmail,
  initialStep,
  initialNotice,
  initialProfile,
  initialOrg,
  initialProject,
  initialDomain,
  initialTransports,
  initialEmail,
}: OnboardingWizardProps) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion() ?? false;

  const [step, setStep] = React.useState<OnboardingStepNumber>(initialStep);
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [busy, setBusy] = React.useState(false);
  const [exiting, setExiting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(initialNotice);

  // Screen 2: Profile state
  const [displayName, setDisplayName] = React.useState(initialProfile.name);
  const [username, setUsername] = React.useState(initialProfile.username);
  const [role, setRole] = React.useState(initialProfile.role || "Developer");
  const [usernameCheck, setUsernameCheck] = React.useState<UsernameCheckState>(() =>
    initialProfile.username && isValidUsername(initialProfile.username)
      ? { status: "available", message: `@${initialProfile.username} is available.` }
      : { status: "idle", message: "" }
  );

  // Screen 3: Organization & Project state
  const [orgId, setOrgId] = React.useState<string | null>(initialOrg?.id ?? null);
  const [orgName, setOrgName] = React.useState(initialOrg?.name ?? "");
  const [orgSlug, setOrgSlug] = React.useState(initialOrg?.slug ?? "");
  const [slugManuallyEdited, setSlugManuallyEdited] = React.useState(Boolean(initialOrg?.slug));
  const [projectId, setProjectId] = React.useState<string | null>(initialProject?.id ?? null);
  const [projectName, setProjectName] = React.useState(initialProject?.name ?? "Production");

  // Screen 4: Sending setup state
  const hasGmailConnected =
    initialTransports.some((t) => t.type === "gmail" && t.status === "active") ||
    initialNotice === "gmail-ok";
  const [sendingMode, setSendingMode] = React.useState<SendingSetupMode>(() => {
    if (hasGmailConnected) return "gmail";
    if (initialDomain) return "domain";
    return "shared";
  });
  const [domainInput, setDomainInput] = React.useState(initialDomain?.domain ?? "");
  const [domainId, setDomainId] = React.useState<string | null>(initialDomain?.id ?? null);
  const [dnsRecords, setDnsRecords] = React.useState<DnsRecord[] | null>(
    initialDomain && initialDomain.records.length > 0 ? initialDomain.records : null
  );
  const [domainStatus, setDomainStatus] = React.useState<"pending" | "verified" | null>(
    initialDomain?.status ?? null
  );
  const [dnsDetail, setDnsDetail] = React.useState<string | null>(null);
  const [checkingDns, setCheckingDns] = React.useState(false);
  const [copiedField, setCopiedField] = React.useState<string | null>(null);

  // Screen 5: First send state
  const [toEmail, setToEmail] = React.useState(initialEmail?.to || userEmail || "");
  const [subject, setSubject] = React.useState(
    initialEmail?.subject || "Your first Calder email worked"
  );
  const [bodyText, setBodyText] = React.useState(
    initialEmail?.text ||
      "If you're reading this, your Calder pipeline is live: validated, queued, sent, and delivered."
  );
  const [emailId, setEmailId] = React.useState<string | null>(
    initialStep >= 5 ? (initialEmail?.id ?? null) : null
  );
  const [emailStatus, setEmailStatus] = React.useState<string | null>(
    initialStep >= 5 ? (initialEmail?.status ?? null) : null
  );

  // Focus management: focus headline on step change
  const headlineRef = React.useRef<HTMLHeadingElement | null>(null);
  const didMountRef = React.useRef(false);
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      headlineRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [step]);

  // Role card refs for arrow-key navigation
  const roleRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  // Sending mode card refs for arrow-key navigation
  const sendingModeRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  // Debounced live username availability check on Screen 2
  React.useEffect(() => {
    const clean = username.toLowerCase().trim();
    if (!clean) {
      setUsernameCheck({ status: "idle", message: "" });
      return;
    }
    if (clean.length < 2) {
      setUsernameCheck({
        status: "invalid",
        message: "Use at least 2 lowercase characters.",
      });
      return;
    }
    if (!isValidUsername(clean)) {
      setUsernameCheck({
        status: "invalid",
        message: "Lowercase letters, numbers, and internal hyphens only (max 39).",
      });
      return;
    }

    setUsernameCheck({ status: "checking", message: `Checking @${clean}…` });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailability(clean);
        if (cancelled) return;
        if (!res.valid) {
          setUsernameCheck({ status: "invalid", message: res.message });
        } else if (res.available) {
          setUsernameCheck({ status: "available", message: res.message });
        } else {
          setUsernameCheck({ status: "taken", message: res.message });
        }
      } catch {
        if (!cancelled) {
          setUsernameCheck({
            status: "available",
            message: `@${clean} looks valid.`,
          });
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  // Live DNS verification polling when Domain path is expanded & pending on Screen 4
  React.useEffect(() => {
    if (step !== 4 || sendingMode !== "domain" || !domainId || domainStatus === "verified") {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const res = await checkDomainDns(domainId);
        setDnsDetail(res.detail);
        if (res.verified) {
          setDomainStatus("verified");
        }
      } catch {
        // Ignore transient background poll errors
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [step, sendingMode, domainId, domainStatus]);

  // Live delivery status polling on Screen 5 (queued → sent → delivered)
  React.useEffect(() => {
    if (!emailId || !projectId) return;
    if (emailStatus === "delivered" || emailStatus === "failed") return;
    const interval = setInterval(async () => {
      try {
        const res = await getEmailStatus({ projectId, emailId });
        setEmailStatus(res.status);
      } catch {
        // Keep polling
      }
    }, 900);
    const timeout = setTimeout(() => clearInterval(interval), 90000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [emailId, projectId, emailStatus]);

  async function runAction<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function navigateToStep(target: OnboardingStepNumber) {
    setError(null);
    setDirection(target >= step ? 1 : -1);
    setStep(target);
    void saveOnboardingStep(target).catch(() => null);
  }

  async function handleSaveAndExit() {
    if (exiting) return;
    setExiting(true);
    setError(null);
    try {
      await saveAndExitOnboarding({
        step,
        name: displayName,
        username,
        role,
      });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save progress.");
      setExiting(false);
    }
  }

  // Step validity predicates
  const isStep2Valid =
    displayName.trim().length >= 2 &&
    username.trim().length >= 2 &&
    isValidUsername(username.trim()) &&
    usernameCheck.status === "available" &&
    Boolean(role);

  const isStep3Valid =
    orgName.trim().length >= 2 &&
    orgSlug.trim().length >= 2 &&
    isValidSlug(orgSlug.trim()) &&
    projectName.trim().length >= 2;

  const isStep4Valid =
    Boolean(projectId) &&
    (sendingMode === "shared" ||
      sendingMode === "gmail" ||
      (sendingMode === "domain" && Boolean(domainId)));

  const isStep5SendValid =
    Boolean(projectId) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim()) &&
    subject.trim().length > 0 &&
    bodyText.trim().length > 0;

  const isStep5Done = emailStatus === "delivered" || emailStatus === "sent";

  // Handlers per step
  async function handleStartSetup() {
    await runAction(async () => {
      setDirection(1);
      setStep(2);
      await saveOnboardingStep(2);
    });
  }

  async function handleProfileContinue() {
    if (!isStep2Valid || busy) return;
    await runAction(async () => {
      await saveProfile({
        name: displayName,
        username,
        role,
      });
      if (!orgName && displayName.trim()) {
        const defaultOrg = `${displayName.trim().split(" ")[0]}'s Workspace`;
        setOrgName(defaultOrg);
        if (!slugManuallyEdited) {
          setOrgSlug(slugify(defaultOrg));
        }
      }
      setDirection(1);
      setStep(3);
    });
  }

  async function handleOrgProjectContinue() {
    if (!isStep3Valid || busy) return;
    await runAction(async () => {
      const saved = await saveOrgAndProjectStep({
        orgId,
        orgName,
        orgSlug,
        projectId,
        projectName,
      });
      setOrgId(saved.orgId);
      setOrgName(saved.orgName);
      setOrgSlug(saved.orgSlug);
      setProjectId(saved.projectId);
      setProjectName(saved.projectName);
      setDirection(1);
      setStep(4);
    });
  }

  async function handleAddDomain() {
    if (!projectId || !domainInput.trim() || busy) return;
    await runAction(async () => {
      const res = await addDomain(projectId, domainInput);
      setDomainId(res.id);
      setDnsRecords(res.records);
      setDomainStatus(res.status ?? "pending");
      setDnsDetail(null);
    });
  }

  async function handleVerifyDns() {
    if (!domainId || checkingDns) return;
    setCheckingDns(true);
    setError(null);
    try {
      const res = await checkDomainDns(domainId);
      setDnsDetail(res.detail);
      if (res.verified) {
        setDomainStatus("verified");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "DNS check failed.");
    } finally {
      setCheckingDns(false);
    }
  }

  async function handleSendingContinue() {
    if (!projectId || !isStep4Valid || busy) return;
    await runAction(async () => {
      await saveSendingSetupStep({ projectId, mode: sendingMode });
      setDirection(1);
      setStep(5);
    });
  }

  async function handleSendFirstEmail() {
    if (!projectId || !isStep5SendValid || busy) return;
    await runAction(async () => {
      const res = await sendFirstEmail({
        projectId,
        to: toEmail,
        subject,
        text: bodyText,
      });
      setEmailId(res.emailId);
      setEmailStatus("queued");
    });
  }

  async function handleAdvanceToDone() {
    if (busy) return;
    await runAction(async () => {
      await saveOnboardingStep(6);
      setDirection(1);
      setStep(6);
    });
  }

  async function handleFinishToDashboard() {
    if (busy) return;
    await runAction(async () => {
      await completeOnboarding();
      router.push(projectId ? `/?project=${projectId}` : "/");
      router.refresh();
    });
  }

  async function handleFinishToApiKey() {
    if (busy) return;
    await runAction(async () => {
      await completeOnboarding();
      router.push(projectId ? `/keys?project=${projectId}` : "/keys");
      router.refresh();
    });
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => {
        setCopiedField((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      // clipboard fallback ignored
    }
  }

  // Keyboard handling: Enter to continue, Esc does nothing destructive
  function handleFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      return;
    }
    if (e.key === "Enter") {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      // Allow natural behavior inside textareas, links, or buttons
      if (tag === "textarea" || tag === "button" || tag === "a") return;
      // Domain input inside Step 4 triggers Get DNS records if records aren't generated yet
      if (step === 4 && target.id === "onb-domain-input" && !dnsRecords) {
        e.preventDefault();
        void handleAddDomain();
        return;
      }
      e.preventDefault();
      if (step === 1) void handleStartSetup();
      else if (step === 2 && isStep2Valid) void handleProfileContinue();
      else if (step === 3 && isStep3Valid) void handleOrgProjectContinue();
      else if (step === 4 && isStep4Valid) void handleSendingContinue();
      else if (step === 5) {
        if (!emailId && isStep5SendValid) void handleSendFirstEmail();
        else if (isStep5Done) void handleAdvanceToDone();
      } else if (step === 6) {
        void handleFinishToDashboard();
      }
    }
  }

  // Framer Motion variants (respecting prefers-reduced-motion)
  const screenVariants = {
    enter: (dir: number) => ({
      x: prefersReducedMotion ? 0 : dir > 0 ? 14 : -14,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
      transition: {
        duration: prefersReducedMotion ? 0.16 : 0.34,
        ease: EASE_OUT_EDITORIAL,
        when: "beforeChildren" as const,
        staggerChildren: prefersReducedMotion ? 0 : 0.055,
      },
    },
    exit: (dir: number) => ({
      x: prefersReducedMotion ? 0 : dir > 0 ? -14 : 14,
      opacity: 0,
      transition: {
        duration: prefersReducedMotion ? 0.12 : 0.24,
        ease: EASE_OUT_EDITORIAL,
      },
    }),
  };

  const itemVariants = {
    enter: {
      y: prefersReducedMotion ? 0 : 8,
      opacity: 0,
    },
    center: {
      y: 0,
      opacity: 1,
      transition: {
        duration: prefersReducedMotion ? 0.15 : 0.3,
        ease: EASE_OUT_EDITORIAL,
      },
    },
  };

  const phaseProgress = getPhaseProgress(step);

  const noticeText =
    notice === "gmail-ok"
      ? "Gmail connected — this project can now send from your address."
      : notice === "gmail-failed"
        ? "Gmail authorization did not complete. Try again or use the shared test sender."
        : notice?.startsWith("gmail-start:")
          ? notice.slice("gmail-start:".length)
          : null;

  return (
    <div className="onb-viewport" onKeyDown={handleFormKeyDown}>
      {/* Minimal Top Bar: Calder wordmark on left, Save and exit on right */}
      <header className="onb-topbar">
        <div className="onb-topbar-brand">
          <CalderLockup size={20} />
        </div>
        <button
          type="button"
          className="onb-save-exit"
          onClick={() => void handleSaveAndExit()}
          disabled={exiting}
        >
          {exiting ? "Saving…" : "Save and exit"}
        </button>
      </header>

      {/* Slim labeled progress bar at the top */}
      <div className="onb-progress-shell">
        <div className="onb-progress-inner">
          <div className="onb-progress-meta">
            <span className="onb-progress-caption mono">SETUP PROGRESS · 3 PHASES</span>
            <span className="onb-step-counter mono" aria-live="polite">
              Step {step} of {ONBOARDING_TOTAL_STEPS}
            </span>
          </div>

          <ol
            className="onb-phase-grid"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={ONBOARDING_TOTAL_STEPS}
            aria-label={`Step ${step} of ${ONBOARDING_TOTAL_STEPS}`}
          >
            {phaseProgress.map(({ phase, status, fillPercent }) => (
              <li
                key={phase.id}
                className={`onb-phase-col onb-phase-${status}`}
                aria-current={status === "active" ? "step" : undefined}
              >
                <div className="onb-phase-label-row">
                  <span className="onb-phase-num mono">
                    {status === "complete" ? "✓" : phase.number}
                  </span>
                  <span className="onb-phase-title-full">{phase.title}</span>
                  <span className="onb-phase-title-short">{phase.shortTitle}</span>
                </div>
                <div className="onb-progress-segment">
                  <motion.div
                    className={`onb-progress-fill onb-progress-fill-${status}`}
                    initial={false}
                    animate={{ width: `${fillPercent}%` }}
                    transition={{
                      duration: prefersReducedMotion ? 0.12 : 0.36,
                      ease: EASE_OUT_EDITORIAL,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Vertically and horizontally centered single-column stage */}
      <main className="onb-stage">
        <div className="onb-column">
          <AnimatePresence initial={false}>
            {noticeText && (
              <motion.div
                key="onb-notice"
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -6 }}
                transition={{ duration: 0.22, ease: EASE_OUT_EDITORIAL }}
                className={`onb-notice ${
                  notice === "gmail-ok" ? "onb-notice-ok" : "onb-notice-warn"
                }`}
                role="status"
                aria-live="polite"
              >
                <span>{noticeText}</span>
                <button
                  type="button"
                  className="onb-notice-dismiss"
                  onClick={() => setNotice(null)}
                >
                  Dismiss
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" custom={direction} initial={false}>
            {/* ── SCREEN 1: WELCOME ── */}
            {step === 1 && (
              <motion.section
                key="step-1"
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="onb-screen"
                aria-labelledby="onb-h1-step1"
              >
                <motion.p variants={itemVariants} className="onb-eyebrow mono">
                  PHASE 01 · ORGANIZATION &amp; PROJECT
                </motion.p>
                <motion.h1
                  id="onb-h1-step1"
                  ref={headlineRef}
                  tabIndex={-1}
                  variants={itemVariants}
                  className="onb-headline"
                >
                  Welcome. Let&rsquo;s get your first message out.
                </motion.h1>
                <motion.p variants={itemVariants} className="onb-subline">
                  Three phases across six guided steps — from workspace setup to a real email
                  delivered to your inbox.
                </motion.p>

                <motion.ol variants={itemVariants} className="onb-preview-list">
                  {ONBOARDING_PHASES.map((phase, idx) => (
                    <motion.li
                      key={phase.id}
                      variants={itemVariants}
                      custom={idx}
                      className="onb-preview-card"
                    >
                      <div className="onb-preview-index mono">{phase.number}</div>
                      <div className="onb-preview-content">
                        <div className="onb-preview-header">
                          <span className="onb-preview-title">{phase.title}</span>
                          <span className="onb-preview-steps mono">
                            {phase.steps.length === 1
                              ? `Step ${phase.steps[0]}`
                              : `Steps ${phase.steps[0]}–${phase.steps[phase.steps.length - 1]}`}
                          </span>
                        </div>
                        <p className="onb-preview-summary">{phase.summary}</p>
                      </div>
                    </motion.li>
                  ))}
                </motion.ol>

                <motion.div variants={itemVariants} className="onb-actions onb-actions-single">
                  <motion.button
                    type="button"
                    whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                    className="onb-btn-primary"
                    disabled={busy}
                    onClick={() => void handleStartSetup()}
                  >
                    {busy ? "Starting…" : "Start setup"}
                  </motion.button>
                </motion.div>
              </motion.section>
            )}

            {/* ── SCREEN 2: PROFILE ── */}
            {step === 2 && (
              <motion.section
                key="step-2"
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="onb-screen"
                aria-labelledby="onb-h1-step2"
              >
                <motion.p variants={itemVariants} className="onb-eyebrow mono">
                  PHASE 01 · PROFILE
                </motion.p>
                <motion.h1
                  id="onb-h1-step2"
                  ref={headlineRef}
                  tabIndex={-1}
                  variants={itemVariants}
                  className="onb-headline"
                >
                  Tell us who&rsquo;s sending.
                </motion.h1>
                <motion.p variants={itemVariants} className="onb-subline">
                  Your profile and handle travel with you across every organization you join.
                </motion.p>

                <motion.div variants={itemVariants} className="onb-fields">
                  <div className="onb-field">
                    <label htmlFor="onb-name" className="onb-label">
                      Your name
                    </label>
                    <input
                      id="onb-name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ada Lovelace"
                      autoComplete="name"
                      className="onb-input"
                    />
                  </div>

                  <div className="onb-field">
                    <div className="onb-label-row">
                      <label htmlFor="onb-username" className="onb-label">
                        Username
                      </label>
                      <span className="onb-label-hint mono">unique · lowercase</span>
                    </div>
                    <div
                      className={`onb-input-prefix-wrap ${
                        usernameCheck.status === "available"
                          ? "is-valid"
                          : usernameCheck.status === "taken" || usernameCheck.status === "invalid"
                            ? "is-invalid"
                            : ""
                      }`}
                    >
                      <span className="onb-input-prefix mono" aria-hidden="true">
                        @
                      </span>
                      <input
                        id="onb-username"
                        type="text"
                        value={username}
                        onChange={(e) =>
                          setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                        }
                        placeholder="ada"
                        autoComplete="username"
                        aria-describedby="onb-username-feedback"
                        aria-invalid={
                          usernameCheck.status === "taken" || usernameCheck.status === "invalid"
                        }
                        className="onb-input-prefixed mono"
                      />
                    </div>
                    <div
                      id="onb-username-feedback"
                      className="onb-field-feedback"
                      aria-live="polite"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {usernameCheck.status !== "idle" && (
                          <motion.span
                            key={`${usernameCheck.status}-${usernameCheck.message}`}
                            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.16 }}
                            className={`onb-feedback-text onb-feedback-${usernameCheck.status} mono`}
                          >
                            {usernameCheck.status === "available" && "✓ "}
                            {(usernameCheck.status === "taken" ||
                              usernameCheck.status === "invalid") &&
                              "✕ "}
                            {usernameCheck.message}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="onb-field">
                    <span id="onb-role-label" className="onb-label">
                      Your role
                    </span>
                    <div
                      role="radiogroup"
                      aria-labelledby="onb-role-label"
                      className="onb-role-grid"
                    >
                      {PROFILE_ROLES.map((item, idx) => {
                        const selected = role === item.value;
                        return (
                          <motion.button
                            key={item.value}
                            ref={(el) => {
                              roleRefs.current[idx] = el;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            tabIndex={selected ? 0 : -1}
                            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                            onClick={() => setRole(item.value)}
                            onKeyDown={(e) => {
                              const total = PROFILE_ROLES.length;
                              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                                e.preventDefault();
                                const nextIdx = (idx + 1) % total;
                                const nextRole = PROFILE_ROLES[nextIdx]!;
                                setRole(nextRole.value);
                                roleRefs.current[nextIdx]?.focus();
                              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                                e.preventDefault();
                                const prevIdx = (idx - 1 + total) % total;
                                const prevRole = PROFILE_ROLES[prevIdx]!;
                                setRole(prevRole.value);
                                roleRefs.current[prevIdx]?.focus();
                              } else if (e.key === "Enter" && isStep2Valid) {
                                e.preventDefault();
                                void handleProfileContinue();
                              }
                            }}
                            className={`onb-role-card ${selected ? "is-selected" : ""}`}
                          >
                            <div className="onb-role-card-top">
                              <span className="onb-role-title">{item.label}</span>
                              <span className="onb-role-indicator" aria-hidden="true">
                                {selected ? "✓" : ""}
                              </span>
                            </div>
                            <span className="onb-role-hint">{item.hint}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>

                <InlineError message={error} prefersReducedMotion={prefersReducedMotion} />

                <motion.div variants={itemVariants} className="onb-actions">
                  <button
                    type="button"
                    className="onb-btn-back"
                    disabled={busy}
                    onClick={() => navigateToStep(1)}
                  >
                    ← Back
                  </button>
                  <motion.button
                    type="button"
                    whileTap={
                      prefersReducedMotion || !isStep2Valid || busy ? undefined : { scale: 0.985 }
                    }
                    className="onb-btn-primary"
                    disabled={busy || !isStep2Valid}
                    onClick={() => void handleProfileContinue()}
                  >
                    {busy ? "Saving profile…" : "Continue"}
                  </motion.button>
                </motion.div>
              </motion.section>
            )}

            {/* ── SCREEN 3: ORGANIZATION & PROJECT ── */}
            {step === 3 && (
              <motion.section
                key="step-3"
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="onb-screen"
                aria-labelledby="onb-h1-step3"
              >
                <motion.p variants={itemVariants} className="onb-eyebrow mono">
                  PHASE 01 · ORGANIZATION &amp; PROJECT
                </motion.p>
                <motion.h1
                  id="onb-h1-step3"
                  ref={headlineRef}
                  tabIndex={-1}
                  variants={itemVariants}
                  className="onb-headline"
                >
                  Create your workspace.
                </motion.h1>
                <motion.p variants={itemVariants} className="onb-subline">
                  Organizations own billing and members. Projects isolate keys, senders, and
                  delivery logs.
                </motion.p>

                <motion.div variants={itemVariants} className="onb-fields">
                  <div className="onb-field">
                    <label htmlFor="onb-org-name" className="onb-label">
                      Organization name
                    </label>
                    <input
                      id="onb-org-name"
                      type="text"
                      value={orgName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOrgName(val);
                        if (!slugManuallyEdited) {
                          setOrgSlug(slugify(val));
                        }
                      }}
                      placeholder="Acme Inc"
                      className="onb-input"
                    />
                  </div>

                  <div className="onb-field">
                    <div className="onb-label-row">
                      <label htmlFor="onb-org-slug" className="onb-label">
                        Organization slug
                      </label>
                      <span className="onb-label-hint mono">editable</span>
                    </div>
                    <div
                      className={`onb-input-prefix-wrap ${
                        orgSlug.length > 0 && (!isValidSlug(orgSlug) || orgSlug.length < 2)
                          ? "is-invalid"
                          : ""
                      }`}
                    >
                      <span className="onb-input-prefix mono" aria-hidden="true">
                        calder.click/
                      </span>
                      <input
                        id="onb-org-slug"
                        type="text"
                        value={orgSlug}
                        onChange={(e) => {
                          setSlugManuallyEdited(true);
                          setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                        }}
                        placeholder="acme-inc"
                        aria-describedby="onb-slug-hint"
                        className="onb-input-prefixed mono"
                      />
                    </div>
                    <div id="onb-slug-hint" className="onb-field-feedback" aria-live="polite">
                      {orgSlug.length > 0 && (!isValidSlug(orgSlug) || orgSlug.length < 2) ? (
                        <span className="onb-feedback-text onb-feedback-invalid mono">
                          ✕ Use at least 2 lowercase letters, numbers, or internal hyphens.
                        </span>
                      ) : (
                        <span className="onb-feedback-text onb-feedback-muted mono">
                          Used in URLs and audit logs.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="onb-field">
                    <label htmlFor="onb-project-name" className="onb-label">
                      First project name
                    </label>
                    <input
                      id="onb-project-name"
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="Production"
                      className="onb-input"
                    />
                  </div>
                </motion.div>

                <InlineError message={error} prefersReducedMotion={prefersReducedMotion} />

                <motion.div variants={itemVariants} className="onb-actions">
                  <button
                    type="button"
                    className="onb-btn-back"
                    disabled={busy}
                    onClick={() => navigateToStep(2)}
                  >
                    ← Back
                  </button>
                  <motion.button
                    type="button"
                    whileTap={
                      prefersReducedMotion || !isStep3Valid || busy ? undefined : { scale: 0.985 }
                    }
                    className="onb-btn-primary"
                    disabled={busy || !isStep3Valid}
                    onClick={() => void handleOrgProjectContinue()}
                  >
                    {busy ? "Creating workspace…" : "Continue"}
                  </motion.button>
                </motion.div>
              </motion.section>
            )}

            {/* ── SCREEN 4: SENDING SETUP ── */}
            {step === 4 && (
              <motion.section
                key="step-4"
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="onb-screen"
                aria-labelledby="onb-h1-step4"
              >
                <motion.p variants={itemVariants} className="onb-eyebrow mono">
                  PHASE 02 · SENDING SETUP
                </motion.p>
                <motion.h1
                  id="onb-h1-step4"
                  ref={headlineRef}
                  tabIndex={-1}
                  variants={itemVariants}
                  className="onb-headline"
                >
                  Choose how to send.
                </motion.h1>
                <motion.p variants={itemVariants} className="onb-subline">
                  Start on the shared sender in seconds, or connect your own identity. You can
                  graduate or switch transports anytime.
                </motion.p>

                <motion.div
                  variants={itemVariants}
                  role="radiogroup"
                  aria-label="Sending setup options"
                  className="onb-choice-stack"
                >
                  {SENDING_MODE_OPTIONS.map((option, idx) => {
                    const selected = sendingMode === option.id;
                    return (
                      <motion.div
                        key={option.id}
                        layout
                        transition={{ duration: prefersReducedMotion ? 0.12 : 0.26, ease: EASE_OUT_EDITORIAL }}
                        className={`onb-choice-card ${selected ? "is-selected" : ""}`}
                      >
                        <div
                          ref={(el) => {
                            sendingModeRefs.current[idx] = el;
                          }}
                          role="radio"
                          aria-checked={selected}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => setSendingMode(option.id)}
                          onKeyDown={(e) => {
                            const total = SENDING_MODE_OPTIONS.length;
                            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                              e.preventDefault();
                              const nextIdx = (idx + 1) % total;
                              setSendingMode(SENDING_MODE_OPTIONS[nextIdx]!.id);
                              sendingModeRefs.current[nextIdx]?.focus();
                            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                              e.preventDefault();
                              const prevIdx = (idx - 1 + total) % total;
                              setSendingMode(SENDING_MODE_OPTIONS[prevIdx]!.id);
                              sendingModeRefs.current[prevIdx]?.focus();
                            } else if (e.key === " ") {
                              e.preventDefault();
                              setSendingMode(option.id);
                            }
                          }}
                          className="onb-choice-header"
                        >
                          <div className="onb-choice-title-row">
                            <span className="onb-choice-radio" aria-hidden="true">
                              <span className="onb-choice-radio-dot" />
                            </span>
                            <span className="onb-choice-title">{option.title}</span>
                            <span
                              className={`onb-choice-badge mono ${
                                option.recommended ? "is-recommended" : ""
                              }`}
                            >
                              {option.badge}
                            </span>
                          </div>
                          <p className="onb-choice-tradeoff">{option.tradeoff}</p>
                        </div>

                        <AnimatePresence initial={false}>
                          {selected && (
                            <motion.div
                              key={`expand-${option.id}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{
                                duration: prefersReducedMotion ? 0.12 : 0.26,
                                ease: EASE_OUT_EDITORIAL,
                              }}
                              className="onb-choice-expand-clip"
                            >
                              <div className="onb-choice-expand">
                                {option.id === "shared" && (
                                  <div className="onb-inline-panel">
                                    <div className="onb-kv-row">
                                      <span className="onb-kv-label mono">SENDER</span>
                                      <span className="onb-kv-val mono">welcome@calder.click</span>
                                    </div>
                                    <div className="onb-kv-row">
                                      <span className="onb-kv-label mono">READINESS</span>
                                      <span className="onb-kv-status-ok mono">
                                        ✓ Ready immediately · No DNS required
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {option.id === "gmail" && (
                                  <div className="onb-inline-panel">
                                    {hasGmailConnected ? (
                                      <div className="onb-kv-row">
                                        <span className="onb-kv-label mono">GMAIL OAUTH</span>
                                        <span className="onb-kv-status-ok mono">
                                          ✓ Connected · 400 sends/day cap
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="onb-gmail-setup">
                                        <p className="onb-inline-note">
                                          Authorize <code className="mono">gmail.send</code> via
                                          Google OAuth. Calder never asks for your password.
                                        </p>
                                        <a
                                          href={
                                            projectId
                                              ? `/api/auth/gmail/connect?project=${projectId}`
                                              : "#"
                                          }
                                          className="onb-btn-secondary onb-btn-inline"
                                        >
                                          Connect Gmail account →
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {option.id === "domain" && (
                                  <div className="onb-inline-panel">
                                    <div className="onb-domain-input-row">
                                      <label htmlFor="onb-domain-input" className="sr-only">
                                        Sending domain
                                      </label>
                                      <input
                                        id="onb-domain-input"
                                        type="text"
                                        value={domainInput}
                                        onChange={(e) =>
                                          setDomainInput(e.target.value.toLowerCase().trim())
                                        }
                                        placeholder="acme.com"
                                        className="onb-input mono"
                                      />
                                      <button
                                        type="button"
                                        className="onb-btn-secondary"
                                        disabled={busy || !domainInput.trim()}
                                        onClick={() => void handleAddDomain()}
                                      >
                                        {busy && !checkingDns
                                          ? "Generating…"
                                          : dnsRecords
                                            ? "Update domain"
                                            : "Get DNS records"}
                                      </button>
                                    </div>

                                    {dnsRecords && dnsRecords.length > 0 && (
                                      <div className="onb-dns-box">
                                        <div className="onb-dns-status-bar" aria-live="polite">
                                          <div className="onb-dns-status-left">
                                            <span
                                              className={`onb-status-dot ${
                                                domainStatus === "verified"
                                                  ? "is-verified"
                                                  : "is-pending"
                                              }`}
                                              aria-hidden="true"
                                            />
                                            <span className="mono onb-dns-status-text">
                                              {domainStatus === "verified"
                                                ? "Verified · Ownership confirmed"
                                                : checkingDns
                                                  ? "Checking authoritative DNS…"
                                                  : "Pending DNS propagation (auto-checking)"}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            className="onb-btn-mini mono"
                                            disabled={checkingDns || domainStatus === "verified"}
                                            onClick={() => void handleVerifyDns()}
                                          >
                                            {domainStatus === "verified"
                                              ? "Verified ✓"
                                              : checkingDns
                                                ? "Checking…"
                                                : "Verify DNS"}
                                          </button>
                                        </div>

                                        {dnsDetail && domainStatus !== "verified" && (
                                          <p className="onb-dns-detail" aria-live="polite">
                                            {dnsDetail}
                                          </p>
                                        )}

                                        <div className="onb-dns-records">
                                          {dnsRecords.map((rec, rIdx) => {
                                            const hostKey = `host-${rIdx}`;
                                            const valKey = `val-${rIdx}`;
                                            return (
                                              <div key={`${rec.host}-${rIdx}`} className="onb-dns-record">
                                                <div className="onb-dns-record-head">
                                                  <span className="onb-dns-type mono">
                                                    {rec.type}
                                                  </span>
                                                  <span className="onb-dns-purpose">
                                                    {rec.purpose}
                                                  </span>
                                                </div>
                                                <div className="onb-dns-copy-row">
                                                  <span className="onb-dns-col-label mono">
                                                    HOST
                                                  </span>
                                                  <code className="onb-dns-code mono">
                                                    {rec.host}
                                                  </code>
                                                  <button
                                                    type="button"
                                                    className="onb-copy-btn mono"
                                                    onClick={() => void copyText(hostKey, rec.host)}
                                                    aria-label={`Copy host ${rec.host}`}
                                                  >
                                                    {copiedField === hostKey ? "Copied ✓" : "Copy"}
                                                  </button>
                                                </div>
                                                <div className="onb-dns-copy-row">
                                                  <span className="onb-dns-col-label mono">
                                                    VALUE
                                                  </span>
                                                  <code className="onb-dns-code mono">
                                                    {rec.value}
                                                  </code>
                                                  <button
                                                    type="button"
                                                    className="onb-copy-btn mono"
                                                    onClick={() => void copyText(valKey, rec.value)}
                                                    aria-label={`Copy value for ${rec.host}`}
                                                  >
                                                    {copiedField === valKey ? "Copied ✓" : "Copy"}
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </motion.div>

                <InlineError message={error} prefersReducedMotion={prefersReducedMotion} />

                <motion.div variants={itemVariants} className="onb-actions">
                  <button
                    type="button"
                    className="onb-btn-back"
                    disabled={busy}
                    onClick={() => navigateToStep(3)}
                  >
                    ← Back
                  </button>
                  <motion.button
                    type="button"
                    whileTap={
                      prefersReducedMotion || !isStep4Valid || busy ? undefined : { scale: 0.985 }
                    }
                    className="onb-btn-primary"
                    disabled={busy || !isStep4Valid}
                    onClick={() => void handleSendingContinue()}
                  >
                    {busy ? "Saving…" : "Continue"}
                  </motion.button>
                </motion.div>
              </motion.section>
            )}

            {/* ── SCREEN 5: FIRST SEND ── */}
            {step === 5 && (
              <motion.section
                key="step-5"
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="onb-screen"
                aria-labelledby="onb-h1-step5"
              >
                <motion.p variants={itemVariants} className="onb-eyebrow mono">
                  PHASE 03 · FIRST SEND
                </motion.p>
                <motion.h1
                  id="onb-h1-step5"
                  ref={headlineRef}
                  tabIndex={-1}
                  variants={itemVariants}
                  className="onb-headline"
                >
                  Send your first email.
                </motion.h1>
                <motion.p variants={itemVariants} className="onb-subline">
                  Pre-filled with your address and a ready payload. Click send to watch live
                  delivery across the pipeline.
                </motion.p>

                <motion.div variants={itemVariants} className="onb-fields">
                  {!emailId ? (
                    <div className="onb-compose-card">
                      <div className="onb-compose-from">
                        <span className="onb-compose-meta-label mono">FROM</span>
                        <span className="onb-compose-meta-val mono">welcome@calder.click</span>
                      </div>

                      <div className="onb-field">
                        <label htmlFor="onb-send-to" className="onb-label">
                          Recipient
                        </label>
                        <input
                          id="onb-send-to"
                          type="email"
                          value={toEmail}
                          onChange={(e) => setToEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="onb-input mono"
                        />
                      </div>

                      <div className="onb-field">
                        <label htmlFor="onb-send-subject" className="onb-label">
                          Subject
                        </label>
                        <input
                          id="onb-send-subject"
                          type="text"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          className="onb-input"
                        />
                      </div>

                      <div className="onb-field onb-field-last">
                        <label htmlFor="onb-send-body" className="onb-label">
                          Body
                        </label>
                        <textarea
                          id="onb-send-body"
                          rows={3}
                          value={bodyText}
                          onChange={(e) => setBodyText(e.target.value)}
                          className="onb-textarea"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="onb-sent-envelope">
                      <div className="onb-sent-envelope-row">
                        <span className="onb-compose-meta-label mono">TO</span>
                        <span className="onb-compose-meta-val mono">{toEmail}</span>
                      </div>
                      <div className="onb-sent-envelope-row">
                        <span className="onb-compose-meta-label mono">SUBJECT</span>
                        <span className="onb-sent-envelope-subj">{subject}</span>
                      </div>
                    </div>
                  )}

                  {/* Live Delivery Payoff Tracker */}
                  <AnimatePresence initial={false}>
                    {emailId && (
                      <motion.div
                        key="delivery-tracker"
                        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.28, ease: EASE_OUT_EDITORIAL }}
                        className="onb-delivery-card"
                        aria-live="polite"
                      >
                        <div className="onb-delivery-head">
                          <span className="mono onb-delivery-title">LIVE DELIVERY TRACE</span>
                          <span className="mono onb-delivery-id">{emailId}</span>
                        </div>
                        <ol className="onb-delivery-steps">
                          {DELIVERY_STEPS.map((ds) => {
                            const st = deliveryStepState(emailStatus, ds.key);
                            const isFinalStep = ds.key === "delivered" && st === "complete";
                            return (
                              <li
                                key={ds.key}
                                className={`onb-delivery-step is-${st} ${
                                  isFinalStep ? "is-final-delivered" : ""
                                }`}
                              >
                                <div className="onb-delivery-node mono" aria-hidden="true">
                                  {st === "complete" ? "✓" : ds.code}
                                </div>
                                <div className="onb-delivery-info">
                                  <div className="onb-delivery-label-row">
                                    <span className="onb-delivery-label">{ds.label}</span>
                                    <span className="onb-delivery-state mono">
                                      {st === "complete"
                                        ? ds.key === "delivered"
                                          ? "200 OK · delivered"
                                          : "complete"
                                        : st === "active"
                                          ? "in progress…"
                                          : "pending"}
                                    </span>
                                  </div>
                                  <span className="onb-delivery-detail">{ds.detail}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                <InlineError message={error} prefersReducedMotion={prefersReducedMotion} />

                <motion.div variants={itemVariants} className="onb-actions">
                  <button
                    type="button"
                    className="onb-btn-back"
                    disabled={busy}
                    onClick={() => navigateToStep(4)}
                  >
                    ← Back
                  </button>
                  {!emailId ? (
                    <motion.button
                      type="button"
                      whileTap={
                        prefersReducedMotion || !isStep5SendValid || busy
                          ? undefined
                          : { scale: 0.985 }
                      }
                      className="onb-btn-primary"
                      disabled={busy || !isStep5SendValid}
                      onClick={() => void handleSendFirstEmail()}
                    >
                      {busy ? "Dispatching…" : "Send first email"}
                    </motion.button>
                  ) : (
                    <motion.button
                      type="button"
                      whileTap={
                        prefersReducedMotion || !isStep5Done || busy
                          ? undefined
                          : { scale: 0.985 }
                      }
                      className="onb-btn-primary"
                      disabled={busy || !isStep5Done}
                      onClick={() => void handleAdvanceToDone()}
                    >
                      {emailStatus === "delivered"
                        ? "Continue"
                        : emailStatus === "sent"
                          ? "Confirming delivery…"
                          : "Queued…"}
                    </motion.button>
                  )}
                </motion.div>
              </motion.section>
            )}

            {/* ── SCREEN 6: DONE ── */}
            {step === 6 && (
              <motion.section
                key="step-6"
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="onb-screen"
                aria-labelledby="onb-h1-step6"
              >
                <motion.p variants={itemVariants} className="onb-eyebrow mono">
                  PHASE 03 · COMPLETE
                </motion.p>
                <motion.h1
                  id="onb-h1-step6"
                  ref={headlineRef}
                  tabIndex={-1}
                  variants={itemVariants}
                  className="onb-headline"
                >
                  Your pipeline is live.
                </motion.h1>
                <motion.p variants={itemVariants} className="onb-subline">
                  First delivery confirmed end-to-end. Your workspace and project are ready for
                  application traffic.
                </motion.p>

                {/* Restrained Editorial Infrastructure celebration card */}
                <motion.div variants={itemVariants} className="onb-done-card">
                  <div className="onb-done-signal-header">
                    <div className="onb-done-seal" aria-hidden="true">
                      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <circle
                          cx="14"
                          cy="14"
                          r="13"
                          stroke="var(--color-accent)"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M9.5 14.5L12.5 17.5L18.5 11"
                          stroke="var(--color-accent)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div>
                      <div className="onb-done-badge mono">FIRST DELIVERY · VERIFIED</div>
                      <p className="onb-done-title">
                        Validated, queued, dispatched, and delivered.
                      </p>
                    </div>
                  </div>

                  <dl className="onb-done-ledger mono">
                    <div className="onb-done-ledger-row">
                      <dt>WORKSPACE</dt>
                      <dd>{orgName || "Workspace"}</dd>
                    </div>
                    <div className="onb-done-ledger-row">
                      <dt>PROJECT</dt>
                      <dd>{projectName || "Production"}</dd>
                    </div>
                    <div className="onb-done-ledger-row">
                      <dt>TRANSPORT</dt>
                      <dd>
                        {sendingMode === "domain"
                          ? domainInput || "Custom domain"
                          : sendingMode === "gmail"
                            ? "Gmail OAuth"
                            : "Shared test sender"}
                      </dd>
                    </div>
                    <div className="onb-done-ledger-row">
                      <dt>RECIPIENT</dt>
                      <dd>{toEmail}</dd>
                    </div>
                  </dl>
                </motion.div>

                <InlineError message={error} prefersReducedMotion={prefersReducedMotion} />

                <motion.div variants={itemVariants} className="onb-actions onb-actions-done">
                  <button
                    type="button"
                    className="onb-btn-back"
                    disabled={busy}
                    onClick={() => navigateToStep(5)}
                  >
                    ← Back
                  </button>
                  <div className="onb-done-cta-group">
                    <motion.button
                      type="button"
                      whileTap={prefersReducedMotion || busy ? undefined : { scale: 0.985 }}
                      className="onb-btn-secondary"
                      disabled={busy}
                      onClick={() => void handleFinishToApiKey()}
                    >
                      Create an API key
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={prefersReducedMotion || busy ? undefined : { scale: 0.985 }}
                      className="onb-btn-primary"
                      disabled={busy}
                      onClick={() => void handleFinishToDashboard()}
                    >
                      {busy ? "Opening…" : "Go to dashboard"}
                    </motion.button>
                  </div>
                </motion.div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function InlineError({
  message,
  prefersReducedMotion,
}: {
  message: string | null;
  prefersReducedMotion: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          key={message}
          role="alert"
          aria-live="assertive"
          initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="onb-inline-error"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
