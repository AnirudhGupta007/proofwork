"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

export function InterviewPanelForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("Engineering interviewer");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/interviewers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, title, timezone })
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to save interviewer.");
      return;
    }
    setName("");
    setEmail("");
    setMessage("Interview panel invite sent. They can open the secure link and set their own availability.");
    router.refresh();
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <div>
        <p className="eyebrow">Interview panel</p>
        <h2>Invite an interviewer</h2>
        <p className="muted">
          Add employees who can run live guided rounds. They receive a secure link to set their weekly availability themselves.
        </p>
      </div>
      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="interviewerName">Name</label>
          <input id="interviewerName" className="input" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="interviewerEmail">Company email</label>
          <input id="interviewerEmail" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
      </div>
      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="interviewerTitle">Panel role</label>
          <input id="interviewerTitle" className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="interviewerTimezone">Timezone</label>
          <input id="interviewerTimezone" className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        </div>
      </div>
      <button className="button" type="submit" disabled={busy}>
        <Send size={16} />
        {busy ? "Sending invite" : "Send interviewer invite"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
