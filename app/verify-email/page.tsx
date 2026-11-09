import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthPanel } from "@/app/components/AuthPanel";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; reason?: string }> }) {
  const params = await searchParams;
  const isCompanyEmailIssue = params.reason === "company-email";

  return (
    <AuthPanel
      eyebrow="Verification required"
      title={isCompanyEmailIssue ? "Use a company email to continue." : "Verify your email to continue."}
      body={
        isCompanyEmailIssue
          ? "Proofwork trials are for employer workspaces, so signup requires a company domain rather than a personal email provider."
          : "Once your email is verified, we will unlock company onboarding and the admin dashboard."
      }
    >
      <div className="auth-fallback">
        <MailCheck size={28} />
        <h2>{isCompanyEmailIssue ? "Company email required" : "Check your inbox"}</h2>
        <p>
          {isCompanyEmailIssue
            ? "Please sign up again with your work email address."
            : `We are waiting for verification${params.email ? ` for ${params.email}` : ""}.`}
        </p>
        <Link className="button" href={isCompanyEmailIssue ? "/sign-up" : "/onboarding"}>
          {isCompanyEmailIssue ? "Use company email" : "I verified my email"}
        </Link>
      </div>
    </AuthPanel>
  );
}
