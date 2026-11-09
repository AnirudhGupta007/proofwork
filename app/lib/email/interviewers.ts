import { Resend } from "resend";
import { callout, ctaButton, emailShell, escapeHtml, metadataTable } from "@/app/lib/email/brand";
import { env } from "@/app/lib/env";

type InterviewerInviteEmailInput = {
  to: string;
  interviewerName: string;
  organizationName: string;
  accessUrl: string;
  expiresAt: Date;
};

export function buildInterviewerInviteEmail(input: InterviewerInviteEmailInput) {
  const expires = input.expiresAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
  const subject = `Proofwork interview panel invite from ${input.organizationName}`;
  const text = [
    `Hi ${input.interviewerName},`,
    "",
    `${input.organizationName} invited you to join their Proofwork interview panel.`,
    "Open the secure link below to set your weekly availability. Candidates will only see slots inside your availability that are not already booked.",
    "",
    `Set availability: ${input.accessUrl}`,
    `This link expires on ${expires}.`
  ].join("\n");

  const html = emailShell({
    preheader: `Set your Proofwork interview availability for ${input.organizationName}.`,
    eyebrow: "Interview panel",
    title: "Set your availability.",
    intro: `Hi ${escapeHtml(input.interviewerName)}, ${escapeHtml(
      input.organizationName
    )} invited you to join their live interview panel on Proofwork.`,
    body: `
      ${metadataTable([
        ["Organization", input.organizationName],
        ["Access", "Secure interviewer link"],
        ["Link expiry", expires]
      ])}
      ${callout(
        "You control your weekly interview windows. Candidates can book only open slots; already-booked times are automatically hidden."
      )}
      <div style="margin-top:28px;">${ctaButton("Set availability", input.accessUrl)}</div>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.55;color:#4A4D48;">If the button does not work, paste this link into your browser:<br /><a href="${escapeHtml(
        input.accessUrl
      )}" style="color:#0A0B0A;text-decoration:underline;word-break:break-all;">${escapeHtml(input.accessUrl)}</a></p>
    `,
    footerNote: "This link lets you manage interview availability only. It does not expose candidate reports or admin settings."
  });

  return { subject, text, html };
}

export async function sendInterviewerInviteEmail(input: InterviewerInviteEmailInput) {
  const email = buildInterviewerInviteEmail(input);
  if (!env.RESEND_API_KEY) return { id: "dry-run", ...email };

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
