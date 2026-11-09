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

  // Wrap with ClerkProvider only when a publishable key is present. The key
  // is fixed for the lifetime of the server process, so the tree is stable;
  // without a key (local dev / CI build) the app runs in single-admin mode
  // and auth pages render <ClerkSetupNotice /> instead of Clerk components.
  const document = (
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
  );

  return clerkPublishableKey ? <ClerkProvider publishableKey={clerkPublishableKey}>{document}</ClerkProvider> : document;
}
