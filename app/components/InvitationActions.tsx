"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw, XCircle } from "lucide-react";

export function InvitationActions({ invitationId, canModify }: { invitationId: string; canModify: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function post(action: "resend" | "cancel") {
    setBusy(action);
    setMessage(null);
    const response = await fetch(`/api/admin/invitations/${invitationId}/${action}`, { method: "POST" });
    const payload = await response.json();
    setBusy(null);

    if (!response.ok) {
      setMessage(payload.error ?? `Unable to ${action} invite.`);
      return;
    }

    setMessage(action === "resend" ? "Invite resent with a fresh link." : "Invite cancelled.");
    router.refresh();
  }

  return (
    <div className="table-actions">
      <button className="button tiny secondary" type="button" disabled={!canModify || Boolean(busy)} onClick={() => void post("resend")}>
        <RotateCcw size={14} />
        {busy === "resend" ? "Sending" : "Resend"}
      </button>
      <button className="button tiny danger" type="button" disabled={!canModify || Boolean(busy)} onClick={() => void post("cancel")}>
        <XCircle size={14} />
        {busy === "cancel" ? "Cancelling" : "Cancel"}
      </button>
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}
