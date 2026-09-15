/**
 * First-party analytics client (apps/web). No dependencies, no PII:
 * only anonymous random ids, paths, referrers, and CTA labels leave the
 * browser (SRS REQ-082). Batches events and ships them to POST /v1/beacon.
 * Every failure path is silent — analytics must never break the page.
 */

const VISITOR_KEY = "calder_analytics_visitor";
const SESSION_KEY = "calder_analytics_session";
const SESSION_TS_KEY = "calder_analytics_session_ts";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30-minute inactivity window

export type EventType = "pageview" | "cta_click" | "form_start" | "form_complete";

interface QueuedEvent {
  type: EventType;
  path?: string;
  label?: string;
  referrer?: string;
  source?: string;
  utm?: Record<string, string>;
  sessionId: string;
  visitorId: string;
  device?: "desktop" | "mobile" | "tablet";
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function beaconUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_API_URL;
  return base ? `${base.replace(/\/$/, "")}/v1/beacon` : null;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readOrCreate(storage: Storage, key: string): string | null {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const fresh = randomId();
    storage.setItem(key, fresh);
    return fresh;
  } catch {
    return null; // storage blocked → skip tracking rather than error
  }
}

export function visitorId(): string | null {
  try {
    return readOrCreate(localStorage, VISITOR_KEY);
  } catch {
    return null;
  }
}

export function sessionId(): string | null {
  try {
    const now = Date.now();
    const ts = Number(sessionStorage.getItem(SESSION_TS_KEY) ?? 0);
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id || now - ts > SESSION_TTL_MS) {
      id = randomId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
    return id;
  } catch {
    return null;
  }
}

function deviceClass(): "desktop" | "mobile" | "tablet" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

function utmContext(): { source?: string; utm?: Record<string, string> } {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
    const v = params.get(key);
    if (v) utm[key] = v.slice(0, 200);
  }
  // Referral code rides along as the source for waitlist attribution joins.
  const ref = params.get("ref");
  const source = utm.utm_source ?? (ref ? `referral:${ref}` : undefined);
  return { source: source?.slice(0, 100), utm: Object.keys(utm).length ? utm : undefined };
}

function flush(): void {
  const url = beaconUrl();
  if (!url || queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  const body = JSON.stringify({ events: batch });
  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through to fetch */
  }
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* silent — never surface analytics failures */
  });
}

function enqueue(event: Omit<QueuedEvent, "sessionId" | "visitorId" | "device">): void {
  const v = visitorId();
  const s = sessionId();
  if (!v || !s) return; // no storage → no analytics, page unaffected
  queue.push({ ...event, sessionId: s, visitorId: v, device: deviceClass() });
  if (queue.length >= 10) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 4000);
  }
}

/** Pageview for the current location. */
export function trackPageview(): void {
  if (typeof window === "undefined") return;
  const { source, utm } = utmContext();
  enqueue({
    type: "pageview",
    path: window.location.pathname.slice(0, 512),
    referrer: document.referrer ? document.referrer.slice(0, 512) : undefined,
    source,
    utm,
  });
}

/** Explicit CTA click (elements carrying [data-cta], or named events). */
export function trackCta(label: string, path?: string): void {
  enqueue({
    type: "cta_click",
    label: label.slice(0, 100),
    path: (path ?? (typeof window !== "undefined" ? window.location.pathname : "/")).slice(0, 512),
  });
}

/** Waitlist form lifecycle (form_start / form_complete). */
export function trackForm(stage: "start" | "complete"): void {
  enqueue({
    type: stage === "start" ? "form_start" : "form_complete",
    path: typeof window !== "undefined" ? window.location.pathname.slice(0, 512) : "/",
  });
}

/** Map a link destination to a public CTA label (spec §14 taxonomy). */
export function ctaLabelForHref(href: string): string | null {
  try {
    const u = new URL(href, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    const p = u.pathname.replace(/\/$/, "") || "/";
    if (p === "/waitlist" || p === "/") return "join_waitlist";
    if (p === "/pricing") return "view_pricing";
    if (p.startsWith("/docs")) return "read_docs";
    if (p === "/developers") return "developers";
    if (p === "/login" || p === "/signin") return "sign_in";
    return null;
  } catch {
    return null;
  }
}

/** Install the delegated click listener + flush-on-hide. Idempotent. */
export function installCollector(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __calderCollector?: boolean };
  if (w.__calderCollector) return;
  w.__calderCollector = true;

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      const el = target.closest<HTMLElement>("[data-cta], a[href]");
      if (!el) return;
      const explicit = el.getAttribute("data-cta");
      if (explicit) {
        trackCta(explicit);
        return;
      }
      const href = el.getAttribute("href");
      if (href) {
        const label = ctaLabelForHref(href);
        if (label) trackCta(label);
      }
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
