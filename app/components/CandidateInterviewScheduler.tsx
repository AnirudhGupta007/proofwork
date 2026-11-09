"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Clock } from "lucide-react";

type Slot = {
  panelMemberId: string;
  interviewerName: string;
  interviewerEmail: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

type Booking = {
  id: string;
  startsAt: string;
  endsAt: string;
  meetingUrl: string;
  interviewerName: string;
  interviewerEmail: string;
};

function formatSlot(value: string) {
  return new Date(value).toLocaleString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function CandidateInterviewScheduler({ token, required }: { token: string; required: boolean }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!required) return;
    let cancelled = false;
    fetch(`/api/candidate/${token}/interview-slots`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        setSlots(payload.slots ?? []);
        setBooking(payload.booking ?? null);
      })
      .catch(() => {
        if (!cancelled) setMessage("Unable to load interview slots.");
      });
    return () => {
      cancelled = true;
    };
  }, [required, token]);

  if (!required) return null;

  async function book(slot: Slot) {
    const key = `${slot.panelMemberId}:${slot.startsAt}`;
    setBusyKey(key);
    setMessage(null);
    const response = await fetch(`/api/candidate/${token}/interview-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ panelMemberId: slot.panelMemberId, startsAt: slot.startsAt })
    });
    const payload = await response.json();
    setBusyKey(null);
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to book this slot.");
      return;
    }
    setBooking({
      id: payload.booking.id,
      startsAt: payload.booking.scheduledStart ?? payload.booking.startsAt,
      endsAt: payload.booking.scheduledEnd ?? payload.booking.endsAt,
      meetingUrl: payload.booking.meetingUrl,
      interviewerName: payload.booking.panelMember?.name ?? slot.interviewerName,
      interviewerEmail: payload.booking.panelMember?.email ?? slot.interviewerEmail
    });
    setSlots([]);
    setMessage("Interview booked. Calendar invites have been emailed to you and the interviewer.");
  }

  return (
    <section className="card grid">
      <div>
        <p className="eyebrow">Live round scheduling</p>
        <h2>Book your interviewer slot</h2>
        <p className="muted">This assessment has a live guided round. You need to book a slot before the timed workspace can start.</p>
      </div>
      {booking ? (
        <div className="notice-panel">
          <strong>
            <CalendarCheck size={16} /> Interview booked
          </strong>
          <span>
            {formatSlot(booking.startsAt)} with {booking.interviewerName}. Calendar invites were sent to both email addresses.
          </span>
          <a className="button secondary" href={booking.meetingUrl} target="_blank" rel="noreferrer">
            Open interview link
          </a>
        </div>
      ) : (
        <div className="slot-grid">
          {slots.slice(0, 12).map((slot) => {
            const key = `${slot.panelMemberId}:${slot.startsAt}`;
            return (
              <button className="slot-button" key={key} type="button" onClick={() => book(slot)} disabled={busyKey !== null}>
                <Clock size={15} />
                <strong>{formatSlot(slot.startsAt)}</strong>
                <span>{slot.interviewerName}</span>
                <small>{slot.timezone}</small>
                {busyKey === key ? <em>Booking...</em> : null}
              </button>
            );
          })}
          {slots.length === 0 ? <p className="muted">No slots are available yet. Ask the hiring team to add interviewer availability.</p> : null}
        </div>
      )}
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
