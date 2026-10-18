import { redirect } from "next/navigation";
import { SIGNUP_URL } from "../../lib/site";

/**
 * Preserve old campaign links while Calder moves from early access to launch.
 * The canonical account entrypoint now owns signup, verification, and onboarding.
 */
export default function WaitlistPage() {
  redirect(SIGNUP_URL);
}
