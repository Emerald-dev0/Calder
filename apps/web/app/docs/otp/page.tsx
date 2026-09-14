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
        <strong>In development.</strong> Managed OTP challenges (create, verify, expire, rate-limit)
        are designed but not shipped. Nothing on this page describes a live endpoint.
      </div>
      <p className="docs-lede">
        The planned shape: email challenges with expiry, an attempt cap and replay prevention.
      </p>
      <h2>What works today</h2>
      <p>
        Generate the code in your application, send it as an ordinary transactional email with an
        idempotency key, and verify it in your own store with a short TTL and a small attempt cap.
        Calder already covers the parts that are awkward to retrofit: the suppression check, retries
        that cannot duplicate the code, and a delivery record you can read when a user says the
        email never arrived.
      </p>
    </>
  );
}
