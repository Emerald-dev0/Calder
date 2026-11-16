"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { publishTemplateVersion } from "./actions";

/**
 * Publish a draft.
 *
 * Sends resolve the newest **published** version, so this button is the only
 * thing that changes what a recipient receives. When validation refuses, the
 * reasons are listed in full rather than summarised: "cannot publish" without
 * naming the problem just moves the debug loop to the API logs.
 */
export function PublishVersionButton({
  projectId,
  templateId,
  version,
  canManage,
}: {
  projectId: string;
  templateId: string;
  version: string;
  canManage: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [problems, setProblems] = React.useState<string[]>([]);
  const router = useRouter();
  if (!canManage) return null;

  async function publish() {
    setBusy(true);
    setProblems([]);
    const result = await publishTemplateVersion(projectId, templateId, version);
    setBusy(false);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        className="ds-btn ds-btn-secondary ds-btn-sm"
        onClick={() => void publish()}
        disabled={busy}
        data-testid={`publish-${version}`}
      >
        <Upload size={13} />
        <span>{busy ? "Publishing…" : "Publish"}</span>
      </button>
      {problems.length > 0 && (
        <ul
          role="alert"
          style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-danger)" }}
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
