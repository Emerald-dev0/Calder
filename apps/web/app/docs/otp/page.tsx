import type { Metadata } from "next";

export const metadata: Metadata = {
 title: "OTP, Calder Docs",
 description: "Email OTP challenges (planned). Current workaround inside.",
};

export default function OtpDoc() {
 return (
 <>
 <h1>OTP</h1>
 <div className="docs-note">
 <strong>Coming soon.</strong> Managed OTP challenges, create, verify, expire, and
 rate-limit one-time codes, are planned, not shipped. The shape below is the design target,
 not documentation of a live API.
 </div>
 <p className="docs-lede">
 Intended shape: email-based challenges with expiration, attempt limits, and replay
 prevention.
 </p>
 <h2>Today&rsquo;s workaround</h2>
 <p>
 Generate codes in your application, send them as ordinary transactional emails with an
 idempotency key, and verify them in your own store with a short TTL and a five-attempt cap.
 When managed OTP lands, migration is a endpoint swap, not a redesign.
 </p>
 </>
 );
}
