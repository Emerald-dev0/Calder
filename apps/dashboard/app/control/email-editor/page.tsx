import { requireSection } from "@/lib/control/guard";
import { PageHeader } from "@/control/_components/ui";
import { getEditorState } from "@/lib/control/editor-actions";
import { EmailEditor } from "./email-editor-client";

export const dynamic = "force-dynamic";

export default async function EmailEditorPage() {
  await requireSection("overview");
  const state = await getEditorState();

  return (
    <>
      <PageHeader
        eyebrow="Command Center"
        title="Confirmation email"
        subtitle="The message people receive after joining the waitlist. Drafts are private until published; every publish is kept as an immutable version."
      />
      <EmailEditor initialState={state} />
    </>
  );
}
