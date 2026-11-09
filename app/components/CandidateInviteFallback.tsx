"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export function CandidateInviteFallback({ token }: { token: string }) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const key = `proofwork-invite-retry:${token}`;
    const attempts = Number(window.sessionStorage.getItem(key) ?? "0");
    if (attempts >= 2) return;

    setRetrying(true);
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(key, String(attempts + 1));
      window.location.reload();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [token]);

  return (
    <main className="candidate-shell">
      <section className="workspace-panel candidate-link-fallback">
        <div>
          <p className="eyebrow">Assessment link</p>
          <h1>Reconnecting your assessment</h1>
          <p className="muted">
            The workspace record is still syncing. This page will retry automatically; you can also refresh it manually.
          </p>
          <button className="button" onClick={() => window.location.reload()} type="button">
            <RefreshCw size={16} />
            {retrying ? "Retrying" : "Refresh assessment"}
          </button>
        </div>
      </section>
    </main>
  );
}
