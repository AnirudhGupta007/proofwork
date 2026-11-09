import { Resend } from "resend";
import { env } from "@/app/lib/env";
import { callout, ctaButton, emailShell, escapeHtml, metadataTable } from "@/app/lib/email/brand";

export type InviteEmailInput = {
  to: string;
  candidateName: string;
  assessmentTitle: string;
  durationMin: number;
  inviteUrl: string;
  expiresAt: Date;
};

function windowLabel(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function buildInviteEmail(input: InviteEmailInput) {
  const displayAssessmentTitle = input.assessmentTitle
    .replace(/^SDE2 Vibecoding:\s*/i, "SDE2 Product Build: ")
    .replace(/\bVibecoding\b/gi, "Product Build")
    .replace(/\bVibecode\b/gi, "Proofwork")
    .replace(/^([A-Z0-9]+) Product Build:\s*(.+?)\s+Product Build$/i, "$1 Product Build: $2");
  const subject = `Proofwork assessment invite: ${displayAssessmentTitle}`;
  const expires = input.expiresAt.toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const candidateName = escapeHtml(input.candidateName);
  const inviteUrl = input.inviteUrl;
  const escapedInviteUrl = escapeHtml(input.inviteUrl);
  const duration = windowLabel(input.durationMin);

  const text = [
    `Hi ${input.candidateName},`,
    "",
    `You have been invited to complete ${displayAssessmentTitle} on Proofwork.`,
    `You will get a hosted coding workspace, browser preview, camera and screen checks, and a ${duration} assessment window after you start.`,
    `This single-use invite expires on ${expires}.`,
    "",
    `Open your assessment: ${input.inviteUrl}`,
    "",
    "Please use a desktop browser and start only when you have the full assessment window available."
  ].join("\n");

  const html = emailShell({
    preheader: `Your ${displayAssessmentTitle} invite expires ${expires}.`,
    eyebrow: "Candidate assessment",
    title: "Show us how you build.",
    intro: `Hi ${candidateName}, you have been invited to complete <strong style="color:#1a1a1a;">${escapeHtml(displayAssessmentTitle)}</strong>. This is a real-world work simulation, not a whiteboard puzzle.`,
    body: `
      ${metadataTable([
        ["Candidate", input.candidateName],
        ["Assessment", displayAssessmentTitle],
        ["Window", `${duration} after you start`],
        ["Invite expiry", expires]
      ])}
      ${callout(
        "You will work inside a hosted coding environment with OpenCode, a terminal, browser preview, and proctoring checks. Start when you have uninterrupted time and a desktop browser available."
      )}
      <div style="margin-top:28px;">${ctaButton("Open assessment", inviteUrl)}</div>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.55;color:#555555;">If the button does not work, paste this link into your browser:<br /><a href="${escapedInviteUrl}" style="color:#1a1a1a;text-decoration:underline;word-break:break-all;">${escapedInviteUrl}</a></p>
    `,
    footerNote: "This is a single-use invite. Candidate accounts are not required for this assessment link."
  });

  return { subject, text, html };
}

export async function sendInviteEmail(input: InviteEmailInput) {
  const email = buildInviteEmail(input);

  if (!env.RESEND_API_KEY) {
    return { id: "dry-run", ...email };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: env.INVITE_EMAIL_FROM,
    to: input.to,
    subject: email.subject,
    text: email.text,
    html: email.html
  });

  if ("error" in result && result.error) {
    throw new Error(result.error.message);
  }

  return result;
}
