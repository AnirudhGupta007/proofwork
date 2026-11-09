import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/app/lib/env";

const globalStyles = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

export const metadata: Metadata = {
  title: "Proofwork",
  description: "AI-native real-world work trials with hosted dev workspaces, evals, and reviewer reports."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Runtime env read via the centralized Zod schema (env.ts) — Next.js
  // does NOT statically replace process.env when accessed as a whole
  // object via .parse(), so the Clerk publishable key is discovered at
  // pod startup from envFrom, not baked into the build.
  const clerkPublishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // Unconditionally wrap with ClerkProvider. A previous version made
  // the wrap conditional on `Boolean(clerkPublishableKey)`, but that
  // could produce SSR/hydration mismatches when the same module is
  // re-evaluated across requests with slightly different env timing —
  // and inside the resulting tree, Clerk's own components (SignIn,
  // AuthenticateWithRedirectCallback) call useSession internally and
  // throw "can only be used within ClerkProvider" when context is
  // missing. Always-wrapped = stable tree regardless of env state.
  //
  // Pages that need to display a "Clerk is not configured" fallback
  // still check `isClerkAuthConfigured()` from admin-context.ts and
  // render <ClerkSetupNotice /> instead of the Clerk component. The
  // outer provider is harmless when key is undefined (Clerk no-ops
  // until a real key arrives, no useSession context errors).
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@300;400;500;600;700&display=swap"
            rel="stylesheet"
          />
          <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
