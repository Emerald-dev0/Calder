import Image from "next/image";
import { configuredProviders } from "@calder/auth";
import { LoginForm } from "./login-form";
import { CalderLockup } from "@calder/ui";

export const metadata = {
  title: "Sign in to Calder",
};

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const providers = configuredProviders();
  const devLogin = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "true";

  return (
    <div className="login-split">
      <div className="login-art" aria-hidden="true">
        <div className="login-art-brand">
          <CalderLockup tone="paper" size={20} />
        </div>
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
          <LoginForm providers={providers} initialError={searchParams?.error} devLogin={devLogin} />
        </div>
      </div>
    </div>
  );
}
