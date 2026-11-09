import Link from "next/link";
import { Building2, MailCheck, PhoneOff, ShieldCheck } from "lucide-react";

type AuthPanelProps = {
  title: string;
  eyebrow?: string;
  body: string;
  children?: React.ReactNode;
};

export function AuthPanel({ title, eyebrow = "Employer access", body, children }: AuthPanelProps) {
  return (
    <main className="auth-page">
      <Link className="home-brand auth-brand" href="/">
        <span className="home-brand-mark">
          <ShieldCheck size={18} />
        </span>
        <span>Proofwork</span>
      </Link>
      <section className="auth-shell">
        <div className="auth-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{body}</p>
          <div className="auth-requirements">
            <span>
              <MailCheck size={16} /> Verified company email
            </span>
            <span>
              <Building2 size={16} /> Company profile
            </span>
            <span>
              <PhoneOff size={16} /> No phone number required
            </span>
            <span>
              <ShieldCheck size={16} /> Free trial: 5 started assessments
            </span>
          </div>
        </div>
        <div className="auth-card">{children}</div>
      </section>
    </main>
  );
}

export function ClerkSetupNotice() {
  return (
    <div className="auth-fallback">
      <h2>Clerk is not configured yet</h2>
      <p>
        Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to enable verified employer signup in this environment.
      </p>
    </div>
  );
}
