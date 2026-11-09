"use client";

import { useEffect, useState } from "react";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

// AuthenticateWithRedirectCallback must be inside a <ClerkProvider>.
// ClerkProvider is mounted by app/layout.tsx based on the RUNTIME env
// (env.ts reads via Zod which bypasses Next.js's static replacement).
// During `next build` the build container has no env, so layout.tsx
// skips ClerkProvider — any SSR/prerender render of this page that
// includes the Clerk callback would throw.
//
// Fix: defer the Clerk component to AFTER client hydration via a
// useEffect-set `mounted` flag. SSR + prerender render the surrounding
// shell with `mounted: false`; once the browser hydrates, mounted flips
// true and the Clerk callback mounts inside the already-running
// ClerkProvider (which exists at runtime because layout.tsx saw the
// real env on the server).
//
// `export const dynamic` was tried first but Next.js still renders the
// page shell during build for the static-pages step; mounted-flag is
// the working approach.

export default function SignInSsoCallbackPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="auth-page auth-callback-page">
      <Link className="home-brand auth-brand" href="/">
        <span className="home-brand-mark">
          <ShieldCheck size={18} />
        </span>
        <span>Proofwork</span>
      </Link>
      <section className="auth-callback-card">
        <p className="eyebrow">Employer access</p>
        <h1>Finishing sign in.</h1>
        <p>We are verifying your session and opening the admin dashboard.</p>
        {mounted && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && (
          <AuthenticateWithRedirectCallback
            signInForceRedirectUrl="/admin"
            signInUrl="/sign-in"
            signUpForceRedirectUrl="/onboarding"
            signUpUrl="/sign-up"
          />
        )}
      </section>
    </main>
  );
}
