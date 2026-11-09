"use client";

import { useState } from "react";
import { CalendarCheck, Save } from "lucide-react";

type InterviewerAvailabilityFormProps = {
  token: string;
  initialAvailabilityText: string;
  initialTimezone: string;
};

export function InterviewerAvailabilityForm({
  token,
  initialAvailabilityText,
  initialTimezone
}: InterviewerAvailabilityFormProps) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [availabilityText, setAvailabilityText] = useState(initialAvailabilityText);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    const response = await fetch(`/api/interviewer/${token}/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone, availabilityText })
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to save availability.");
      return;
    }

    setMessage("Availability saved. Candidates will only see open slots that do not conflict with existing bookings.");
  }

  return (
    <form className="card grid" onSubmit={save}>
      <div>
        <p className="eyebrow">Weekly availability</p>
        <h2>Set interview slots</h2>
        <p className="muted">
          Add the windows when candidates can book you. Use one line per window, for example `Mon 10:00-13:00` or `Thu 2pm-5pm`.
        </p>
      </div>
      <div className="field">
        <label htmlFor="interviewerTimezone">Timezone</label>
        <input
          id="interviewerTimezone"
          className="input"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="interviewerAvailability">Availability windows</label>
        <textarea
          id="interviewerAvailability"
          className="textarea tall"
          value={availabilityText}
          onChange={(event) => setAvailabilityText(event.target.value)}
          placeholder={"Mon 10:00-13:00\nWed 14:00-17:00\nFri 11am-2pm"}
          required
        />
      </div>
      <div className="notice-panel">
        <CalendarCheck size={18} />
        <span>
          Already booked slots are automatically hidden from candidates. You can reopen this link later to update your weekly availability.
        </span>
      </div>
      <button className="button" type="submit" disabled={busy}>
        <Save size={16} />
        {busy ? "Saving" : "Save availability"}
      </button>
      {message ? <p className="status green">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}
