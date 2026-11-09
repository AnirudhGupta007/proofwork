import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { createInviteToken, hashInviteToken } from "@/app/lib/domain/invites";
import { addMinutes } from "@/app/lib/domain/time";
import { env } from "@/app/lib/env";
import { sendInviteEmail } from "@/app/lib/email/invites";
import { warmOneForInvitation } from "@/app/lib/workspaces/pool";

const createInvitationSchema = z.object({
  candidateName: z.string().min(2).optional(),
  candidateEmail: z.string().email().optional(),
  templateId: z.string().min(2).optional(),
  interviewerId: z.string().min(2).optional(),
  proctoringEnabled: z.boolean().default(true),
  candidates: z
    .array(
      z.object({
        name: z.string().min(2),
        email: z.string().email()
      })
    )
    .min(1)
    .max(100)
    .optional()
});

function normalizeCandidates(input: z.infer<typeof createInvitationSchema>) {
  if (input.candidates?.length) {
    return input.candidates.map((candidate) => ({ name: candidate.name.trim(), email: candidate.email.trim().toLowerCase() }));
  }

  if (input.candidateName && input.candidateEmail) {
    return [{ name: input.candidateName.trim(), email: input.candidateEmail.trim().toLowerCase() }];
  }

  throw new Error("Add at least one candidate name and email.");
}

function inviteProctoringConfig(enabled: boolean) {
  return {
    enabled,
    cameraRequired: enabled,
    screenShareRequired: enabled,
    recordVideo: enabled,
    recordScreen: enabled,
    events: enabled ? ["face_missing", "screen_share_stopped", "tab_blur", "copy_paste_large", "network_disconnect"] : []
  };
}

export async function GET() {
  const { organization } = await getAdminContext();
  const invitations = await db.invitation.findMany({
    where: { organizationId: organization.id },
    include: { candidate: true, template: true, attempt: true },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ invitations });
}

export async function POST(request: Request) {
  try {
    const input = createInvitationSchema.parse(await request.json());
    const { organization, template } = await getAdminContext();
    const selectedTemplate = input.templateId
      ? await db.assessmentTemplate.findFirst({
          where: { id: input.templateId, organizationId: organization.id }
        })
      : template;
    if (!selectedTemplate) throw new Error("Choose a valid assessment template.");
    const selectedInterviewer = input.interviewerId
      ? await db.interviewPanelMember.findFirst({
          where: { id: input.interviewerId, organizationId: organization.id, isActive: true }
        })
      : null;
    if (input.interviewerId && !selectedInterviewer) throw new Error("Choose a valid active interviewer.");

    const expiresAt = addMinutes(new Date(), 7 * 24 * 60);
    const candidates = normalizeCandidates(input).map((candidate) => ({ ...candidate, token: createInviteToken() }));
    const invitations = await db.$transaction(async (tx) => {
      const created = [];

      for (const candidateInput of candidates) {
        const candidate = await tx.candidate.upsert({
          where: {
            email_name: {
                  email: candidateInput.email,
                  name: candidateInput.name
            }
          },
          update: {},
          create: {
                email: candidateInput.email,
                name: candidateInput.name
          }
        });

        const invitation = await tx.invitation.create({
          data: {
            organizationId: organization.id,
            templateId: selectedTemplate.id,
            candidateId: candidate.id,
            interviewerId: selectedInterviewer?.id,
            proctoringConfig: inviteProctoringConfig(input.proctoringEnabled),
            tokenHash: hashInviteToken(candidateInput.token),
            creditCost: 1,
            expiresAt
          },
          include: { candidate: true, template: true, organization: true }
        });

        created.push({ invitation, token: candidateInput.token });
      }

      return created;
    });

    const results = [];
    const failures = [];

    for (const created of invitations) {
      const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/assessment/${created.token}`;
      try {
        await sendInviteEmail({
          to: created.invitation.candidate.email,
          candidateName: created.invitation.candidate.name,
          assessmentTitle: selectedTemplate.title,
          durationMin: selectedTemplate.durationMin,
          inviteUrl,
          expiresAt
        });
        results.push({ invitation: created.invitation, inviteUrl });
        // Fire-and-forget: pre-warm a Daytona sandbox reserved for
        // THIS invitation so the candidate's click lands on a ready
        // workspace in sub-30s. Falls back to template pool / cold
        // path if warm fails — pool service handles all that.
        void warmOneForInvitation(created.invitation.id).catch(() => undefined);
      } catch (err) {
        await db.invitation.update({
          where: { id: created.invitation.id },
          data: { status: "cancelled", cancelledAt: new Date() }
        });
        failures.push({
          email: created.invitation.candidate.email,
          error: err instanceof Error ? err.message : "Invite email failed"
        });
      }
    }

    const freshOrganization = await db.organization.findUniqueOrThrow({
      where: { id: organization.id },
      select: { evaluationCredits: true }
    });

    return NextResponse.json(
      {
        invitations: results.map((result) => result.invitation),
        inviteUrls: results.map((result) => result.inviteUrl),
        failures,
        creditsRemaining: freshOrganization.evaluationCredits
      },
      { status: failures.length > 0 ? 207 : 201 }
    );
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to create invitation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
