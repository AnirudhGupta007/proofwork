import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { companyNameFromDomain, emailDomain, isCompanyEmail, slugifyCompanyName } from "@/app/lib/company-email";
import { db } from "@/app/lib/db";
import { isClerkAuthConfigured } from "@/app/lib/admin-context";

const onboardingSchema = z.object({
  companyName: z.string().min(2),
  website: z.string().max(240).optional().or(z.literal("")),
  organizationRole: z.string().max(80).optional().or(z.literal("")),
  hiringPlan: z.string().max(1000).optional().or(z.literal(""))
});

function normalizeWebsite(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function uniqueSlug(base: string) {
  let slug = base;
  for (let index = 1; index < 20; index += 1) {
    const existing = await db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
    slug = `${base}-${index + 1}`;
  }
  return `${base}-${Date.now()}`;
}

export async function POST(request: Request) {
  try {
    if (!isClerkAuthConfigured()) {
      return NextResponse.json({ error: "Clerk is not configured for verified employer onboarding." }, { status: 503 });
    }

    const input = onboardingSchema.parse(await request.json());
    const website = normalizeWebsite(input.website);
    if (website) {
      try {
        new URL(website);
      } catch {
        return NextResponse.json({ error: "Enter a valid company website, like example.com." }, { status: 400 });
      }
    }
    const [{ userId }, user] = await Promise.all([auth(), currentUser()]);
    const email = user?.primaryEmailAddress?.emailAddress;

    if (!userId || !user || !email) return NextResponse.json({ error: "Sign in before onboarding." }, { status: 401 });
    if (user.primaryEmailAddress?.verification?.status !== "verified") {
      return NextResponse.json({ error: "Verify your company email before onboarding." }, { status: 403 });
    }
    if (!isCompanyEmail(email)) {
      return NextResponse.json({ error: "Use a company email address to start a Proofwork employer workspace." }, { status: 403 });
    }

    const domain = emailDomain(email);
    if (!domain) return NextResponse.json({ error: "Could not detect company domain from email." }, { status: 400 });

    const slug = await uniqueSlug(slugifyCompanyName(input.companyName, domain.split(".")[0]));
    const organization = await db.$transaction(async (tx) => {
      const existingAdmin = await tx.adminUser.findUnique({
        where: { clerkUserId: userId },
        include: { organization: true }
      });
      if (existingAdmin) return existingAdmin.organization;

      const existingOrganization = await tx.organization.findFirst({ where: { domain } });
      const organization =
        existingOrganization ??
        (await tx.organization.create({
          data: {
            name: input.companyName || companyNameFromDomain(domain),
            slug,
            domain,
            website: website || null,
            hiringPlan: input.hiringPlan || null,
            planName: "Free trial",
            evaluationCredits: 5,
            onboardedAt: new Date()
          }
        }));

      await tx.adminUser.create({
        data: {
          clerkUserId: userId,
          email,
          name: user.fullName,
          organizationRole: input.organizationRole || null,
          organizationId: organization.id
        }
      });

      return organization;
    });

    return NextResponse.json({ organization });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to complete onboarding";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
