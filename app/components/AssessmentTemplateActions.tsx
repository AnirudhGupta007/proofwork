"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export function AssessmentTemplateActions({ templateId, isActive }: { templateId: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function activate() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/assessment-template", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId })
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to activate assessment.");
      return;
    }

    setMessage("Active for new invites.");
    router.refresh();
  }

  return (
    <div className="template-actions">
      {isActive ? (
        <span className="status green">
          <CheckCircle2 size={14} /> Active
        </span>
      ) : (
        <button className="button secondary compact-button" type="button" onClick={activate} disabled={busy}>
          {busy ? "Activating" : "Make active"}
        </button>
      )}
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}
