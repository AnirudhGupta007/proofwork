"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

type EmployerOnboardingFormProps = {
  email: string;
  defaultCompanyName: string;
};

function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function EmployerOnboardingForm({ email, defaultCompanyName }: EmployerOnboardingFormProps) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [website, setWebsite] = useState("");
  const [organizationRole, setOrganizationRole] = useState("");
  const [hiringPlan, setHiringPlan] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);
    setIsSubmitting(true);

    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, website: normalizeWebsite(website), organizationRole, hiringPlan })
    });
    const payload = await response.json();
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus(payload.error ?? "Unable to complete onboarding.");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <form className="onboarding-form" onSubmit={submit}>
      <div>
        <p className="eyebrow">Verified employer</p>
        <h2>Set up your company</h2>
        <p className="muted">{email}</p>
      </div>
      <div className="field">
        <label htmlFor="companyName">Company name</label>
        <input id="companyName" className="input" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="website">Company website</label>
        <input
          id="website"
          className="input"
          placeholder="company.com"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="organizationRole">Your role</label>
        <input
          id="organizationRole"
          className="input"
          placeholder="Founder, recruiter, engineering manager"
          value={organizationRole}
          onChange={(event) => setOrganizationRole(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="hiringPlan">What are you hiring for?</label>
        <textarea
          id="hiringPlan"
          className="textarea compact"
          placeholder="Example: 2 product engineers and 1 AI product manager this quarter"
          value={hiringPlan}
          onChange={(event) => setHiringPlan(event.target.value)}
        />
      </div>
      <button className="button" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating workspace" : "Create employer workspace"} <ArrowRight size={16} />
      </button>
      {status ? <p className="muted">{status}</p> : null}
    </form>
  );
}
