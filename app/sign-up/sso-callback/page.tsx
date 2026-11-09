"use client";

import { useEffect, useState } from "react";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

// See app/sign-in/sso-callback/page.tsx for the rationale on the
// mounted-flag pattern.

export default function SignUpSsoCallbackPage() {
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
        <h1>Finishing sign up.</h1>
        <p>We are verifying your company account and preparing onboarding.</p>
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
