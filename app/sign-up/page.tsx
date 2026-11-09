import { SignUp } from "@clerk/nextjs";
import { AuthPanel, ClerkSetupNotice } from "@/app/components/AuthPanel";
import { isClerkAuthConfigured } from "@/app/lib/admin-context";
import { clerkAppearance } from "@/app/lib/clerk-appearance";

// See app/sign-in/page.tsx — same rationale: prevent static prerender
// from baking the build-time env into the HTML.
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <AuthPanel
      title="Start your free employer trial."
      body="Create an employer account with your company email. No phone number is needed; after email verification, we collect company details and open the admin dashboard."
    >
      {isClerkAuthConfigured() ? (
        <SignUp
          appearance={clerkAppearance}
          fallbackRedirectUrl="/onboarding"
          forceRedirectUrl="/onboarding"
          routing="hash"
          signInUrl="/sign-in"
        />
      ) : (
        <ClerkSetupNotice />
      )}
    </AuthPanel>
  );
}
