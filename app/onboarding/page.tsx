import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthPanel, ClerkSetupNotice } from "@/app/components/AuthPanel";
import { EmployerOnboardingForm } from "@/app/components/EmployerOnboardingForm";
import { companyNameFromDomain, emailDomain, isCompanyEmail } from "@/app/lib/company-email";
import { db } from "@/app/lib/db";
import { isClerkAuthConfigured } from "@/app/lib/admin-context";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!isClerkAuthConfigured()) {
    return (
      <AuthPanel title="Configure employer signup." body="Proofwork needs Clerk keys before verified company-email onboarding can run.">
        <ClerkSetupNotice />
      </AuthPanel>
    );
  }

  const [{ userId }, user] = await Promise.all([auth(), currentUser()]);
  if (!userId || !user) redirect("/sign-up");

  const email = user.primaryEmailAddress?.emailAddress;
  if (!email || user.primaryEmailAddress?.verification?.status !== "verified") {
    redirect(email ? (`/verify-email?email=${encodeURIComponent(email)}` as "/verify-email") : "/verify-email");
  }

  if (!isCompanyEmail(email)) redirect("/verify-email?reason=company-email");

  const existingAdmin = await db.adminUser.findUnique({ where: { clerkUserId: userId }, select: { id: true } });
  if (existingAdmin) redirect("/admin");

  const domain = emailDomain(email);

  return (
    <AuthPanel
      title="Tell us about your company."
      body="This creates your employer workspace, activates 5 free started assessments, and keeps candidates separate from admin access."
    >
      <EmployerOnboardingForm email={email} defaultCompanyName={domain ? companyNameFromDomain(domain) : ""} />
    </AuthPanel>
  );
}
