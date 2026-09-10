import Image from "next/image";
import { configuredProviders } from "@calder/auth";
import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Create your Calder account",
};

export default function SignupPage() {
  const providers = configuredProviders();

  return (
    <div className="login-split">
      <div className="login-art" aria-hidden="true">
        <p className="login-art-brand">Calder</p>
        <h2 className="login-art-headline">Reliable delivery, made legible.</h2>
        <p className="login-art-sub">
          One unified infrastructure for modern developers. Everything on the record:
          queued, sent, delivered, with zero mystery.
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
          <SignupForm providers={providers} />
        </div>
      </div>
    </div>
  );
}
