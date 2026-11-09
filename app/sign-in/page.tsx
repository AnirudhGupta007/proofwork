import { SignIn } from "@clerk/nextjs";
import { AuthPanel, ClerkSetupNotice } from "@/app/components/AuthPanel";
import { isClerkAuthConfigured } from "@/app/lib/admin-context";
import { clerkAppearance } from "@/app/lib/clerk-appearance";

// Force runtime rendering. Without this, Next.js statically prerenders
// /sign-in at build time, evaluating isClerkAuthConfigured() against the
// empty build-container env — baking "Clerk is not configured yet" into
// the static HTML regardless of what env Kubernetes injects at runtime.
// See app/lib/env.ts for the runtime-env-read pattern this enables.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <AuthPanel
      title="Sign in to Proofwork."
      body="Use the verified company email attached to your employer workspace."
    >
      {isClerkAuthConfigured() ? (
        <SignIn
          appearance={clerkAppearance}
          fallbackRedirectUrl="/admin"
          forceRedirectUrl="/admin"
          routing="hash"
          signUpUrl="/sign-up"
        />
      ) : (
        <ClerkSetupNotice />
      )}
    </AuthPanel>
  );
}
