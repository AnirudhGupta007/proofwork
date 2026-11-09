import { PrismaClient } from "@prisma/client";
import { Resend } from "resend";
import { createInviteToken, hashInviteToken } from "../app/lib/domain/invites.ts";

const db = new PrismaClient();

function env(name: string) {
  return process.env[name] ?? "";
}

function assessmentSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
}

function inviteEmail({
  candidateName,
  title,
  inviteUrl,
  expiresAt
}: {
  candidateName: string;
  title: string;
  inviteUrl: string;
  expiresAt: Date;
}) {
  const expires = expiresAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
  const subject = `Proofwork assessment invite: ${title}`;
  const text = [
    `Hi ${candidateName},`,
    "",
    `You have been invited to complete ${title} on Proofwork.`,
    "You will work in a hosted coding workspace with OpenCode CLI, a browser preview, and proctoring checks.",
    `This single-use invite expires on ${expires}.`,
    "",
    inviteUrl
  ].join("\n");
  const html = `
    <div style="margin:0;background:#fbfaf7;padding:32px;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dedbd2;padding:32px;">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#555;">Candidate assessment</div>
        <h1 style="font-family:Georgia,serif;font-size:36px;line-height:1.05;margin:18px 0 12px;">Show us how you build.</h1>
        <p style="font-size:16px;line-height:1.6;color:#555;">Hi ${candidateName}, you have been invited to complete <strong>${title}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0;border-top:1px solid #dedbd2;border-bottom:1px solid #dedbd2;">
          <tr><td style="padding:10px 0;color:#555;">Assessment</td><td style="padding:10px 0;text-align:right;font-weight:bold;">${title}</td></tr>
          <tr><td style="padding:10px 0;color:#555;">Window</td><td style="padding:10px 0;text-align:right;font-weight:bold;">Starts when workspace is ready</td></tr>
          <tr><td style="padding:10px 0;color:#555;">Invite expiry</td><td style="padding:10px 0;text-align:right;font-weight:bold;">${expires}</td></tr>
        </table>
        <a href="${inviteUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 18px;font-weight:bold;">Open assessment</a>
        <p style="font-size:12px;line-height:1.6;color:#555;margin-top:24px;">If the button does not work, paste this link into your browser:<br><a href="${inviteUrl}" style="color:#1a1a1a;word-break:break-all;">${inviteUrl}</a></p>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function main() {
  const to = process.argv[2] ?? "reports@example.com";
  const appUrl = env("NEXT_PUBLIC_APP_URL") || "http://localhost:3001";
  const resendKey = env("RESEND_API_KEY");
  const from = env("INVITE_EMAIL_FROM") || "Proofwork <onboarding@resend.dev>";
  const resend = resendKey ? new Resend(resendKey) : null;

  const organization = await db.organization.findFirst({ where: { slug: "demo" } });
  if (!organization) throw new Error("Demo organization not found.");

  const templates = await db.assessmentTemplate.findMany({
    where: {
      organizationId: organization.id,
      evaluationPlan: { path: ["createdBySeed"], equals: "scripts/create-sample-assessments.ts" }
    },
    orderBy: [{ level: "asc" }, { title: "asc" }]
  });

  await db.organization.update({
    where: { id: organization.id },
    data: { evaluationCredits: { increment: Math.max(0, templates.length + 3 - organization.evaluationCredits) } }
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sent = [];

  for (const [index, template] of templates.entries()) {
    const token = createInviteToken();
    const slug = assessmentSlug(template.title);
    const candidateName = `E2E Candidate ${String(index + 1).padStart(2, "0")} ${template.level}`;
    const candidate = await db.candidate.create({
      data: {
        name: candidateName,
        email: to
      }
    });
    const invitation = await db.invitation.create({
      data: {
        organizationId: organization.id,
        templateId: template.id,
        candidateId: candidate.id,
        tokenHash: hashInviteToken(token),
        expiresAt
      },
      include: { candidate: true, template: true }
    });
    const inviteUrl = `${appUrl}/assessment/${token}`;
    const email = inviteEmail({ candidateName, title: template.title, inviteUrl, expiresAt });
    let emailId = "dry-run";
    if (resend) {
      const result = await resend.emails.send({ from, to, subject: email.subject, text: email.text, html: email.html });
      if ("error" in result && result.error) throw new Error(result.error.message);
      emailId = "data" in result && result.data?.id ? result.data.id : "sent";
    }

    sent.push({
      index: index + 1,
      slug,
      invitationId: invitation.id,
      templateId: template.id,
      title: template.title,
      candidateName,
      to,
      inviteUrl,
      emailId
    });
  }

  console.log(JSON.stringify({ sent }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
