import { Resend } from "resend";
import { env } from "@/app/lib/env";
import { callout, ctaButton, emailShell, escapeHtml, metadataTable } from "@/app/lib/email/brand";

type InterviewCalendarInput = {
  candidateName: string;
  candidateEmail: string;
  interviewerName: string;
  interviewerEmail: string;
  assessmentTitle: string;
  startsAt: Date;
  endsAt: Date;
  meetingUrl: string;
  calendarUid: string;
};

function formatUtcDate(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function buildInterviewIcs(input: InterviewCalendarInput) {
  const now = formatUtcDate(new Date());
  const summary = `Proofwork live interview: ${input.assessmentTitle}`;
  const description = [
    `Candidate: ${input.candidateName} <${input.candidateEmail}>`,
    `Interviewer: ${input.interviewerName} <${input.interviewerEmail}>`,
    `Open interview link: ${input.meetingUrl}`,
    "",
    "This event was scheduled from Proofwork. The assessment workspace and evidence report are connected to this live guided round."
  ].join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Proofwork//Interview Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${input.calendarUid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${formatUtcDate(input.startsAt)}`,
    `DTEND:${formatUtcDate(input.endsAt)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(input.meetingUrl)}`,
    `ORGANIZER;CN=${escapeIcs(input.interviewerName)}:mailto:${input.interviewerEmail}`,
    `ATTENDEE;CN=${escapeIcs(input.candidateName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${input.candidateEmail}`,
    `ATTENDEE;CN=${escapeIcs(input.interviewerName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${input.interviewerEmail}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

export function buildInterviewEmail(input: InterviewCalendarInput) {
  const when = input.startsAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
  const subject = `Proofwork live interview scheduled: ${input.assessmentTitle}`;
  const text = [
    `Live interview scheduled for ${input.assessmentTitle}`,
    "",
    `Candidate: ${input.candidateName} <${input.candidateEmail}>`,
    `Interviewer: ${input.interviewerName} <${input.interviewerEmail}>`,
    `Time: ${when}`,
    `Join: ${input.meetingUrl}`
  ].join("\n");

  const html = emailShell({
    preheader: `Live interview scheduled for ${when}.`,
    eyebrow: "Live interview",
    title: "Interview scheduled.",
    intro: `A live guided Proofwork round has been scheduled for <strong style="color:#1a1a1a;">${escapeHtml(input.assessmentTitle)}</strong>.`,
    body: `
      ${metadataTable([
        ["Candidate", `${input.candidateName} <${input.candidateEmail}>`],
        ["Interviewer", `${input.interviewerName} <${input.interviewerEmail}>`],
        ["Time", when],
        ["Duration", `${Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60000)} minutes`]
      ])}
      ${callout("The attached calendar invite should appear in Google Calendar. Use the interview link to join the guided round and review the candidate workspace context.")}
      <div style="margin-top:28px;">${ctaButton("Open interview link", input.meetingUrl)}</div>
    `,
    footerNote: "Proofwork logs live guided communication and scores it alongside the candidate's shipped work."
  });

  return { subject, text, html };
}

export async function sendInterviewCalendarInvite(input: InterviewCalendarInput) {
  const email = buildInterviewEmail(input);
  const ics = buildInterviewIcs(input);
  if (!env.RESEND_API_KEY) return { id: "dry-run", ...email, ics };

  const resend = new Resend(env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: env.INVITE_EMAIL_FROM,
    to: [input.candidateEmail, input.interviewerEmail],
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: [
      {
        filename: "proofwork-live-interview.ics",
        content: Buffer.from(ics),
        contentType: "text/calendar; method=REQUEST; charset=UTF-8"
      }
    ]
  });

  if ("error" in result && result.error) {
    throw new Error(result.error.message);
  }

  return result;
}
