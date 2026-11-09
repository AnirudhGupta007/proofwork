import { auth, currentUser } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { generateAssessmentFromJd } from "@/app/lib/assessment-generator";
import { isCompanyEmail } from "@/app/lib/company-email";
import { defaultRubric } from "@/app/lib/domain/score";
import { env } from "@/app/lib/env";
import { db } from "@/app/lib/db";

export function isClerkAuthConfigured() {
  // Runtime read via centralized env.ts — bypasses Next.js's
  // process.env.NAME static replacement (Zod parses the whole
  // process.env object, which isn't replaced).
  return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

export async function getAdminContext() {
  const clerk = await getOptionalClerkUser();
  const user = clerk.user;
  const email = user?.primaryEmailAddress?.emailAddress ?? "admin@example.com";
  const clerkUserId = clerk.userId ?? "local-admin";

  let organization;
  let admin;

  if (isClerkAuthConfigured()) {
    if (!clerk.userId || !user) redirect("/sign-in");
    if (!isVerifiedPrimaryEmail(user)) redirect(`/verify-email?email=${encodeURIComponent(email)}` as "/verify-email");
    if (!isCompanyEmail(email)) redirect("/verify-email?reason=company-email");

    admin = await db.adminUser.findUnique({
      where: { clerkUserId },
      include: { organization: true }
    });

    if (!admin) redirect("/onboarding");

    organization = admin.organization;
  } else {
    organization = await db.organization.upsert({
      where: { slug: "default" },
      update: {},
      create: { name: "Default Hiring Team", slug: "default", planName: "Free trial", evaluationCredits: 5, onboardedAt: new Date() }
    });

    admin = await db.adminUser.upsert({
      where: { clerkUserId },
      update: { email },
      create: {
        clerkUserId,
        email,
        name: user?.fullName,
        organizationId: organization.id
      }
    });
  }

  const fallbackAssessment = generateAssessmentFromJd({
    roleTitle: "Product Engineer",
    level: "Mid",
    jobDescription:
      "Product engineer who can build and evaluate an AI product workflow, use coding agents responsibly, design tests, and explain product/engineering tradeoffs.",
    proctoringEnabled: false
  });

  let template = await db.assessmentTemplate.findFirst({
    where: { organizationId: organization.id, isActive: true },
    orderBy: { updatedAt: "desc" }
  });

  if (!template) {
    template = await db.assessmentTemplate.create({
      data: {
        organizationId: organization.id,
        title: fallbackAssessment.title,
        roleTitle: fallbackAssessment.roleTitle,
        level: fallbackAssessment.level,
        durationMin: fallbackAssessment.durationMin,
        repoUrl: env.ASSESSMENT_TASK_REPO_URL ?? fallbackAssessment.repoUrl,
        instructions: fallbackAssessment.instructions,
        generatedFromJd: fallbackAssessment.generatedFromJd,
        taskBrief: fallbackAssessment.taskBrief,
        evaluationPlan: fallbackAssessment.evaluationPlan as Prisma.InputJsonValue,
        proctoringConfig: fallbackAssessment.proctoringConfig as Prisma.InputJsonValue,
        rubric: defaultRubric,
        isActive: true
      }
    });
  }

  return { organization, admin, template };
}

async function getOptionalClerkUser() {
  try {
    const [{ userId }, user] = await Promise.all([auth(), currentUser()]);
    return { userId, user };
  } catch {
    return { userId: null, user: null };
  }
}

function isVerifiedPrimaryEmail(user: Awaited<ReturnType<typeof currentUser>>) {
  return user?.primaryEmailAddress?.verification?.status === "verified";
}
