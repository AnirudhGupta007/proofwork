import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  ClipboardList,
  Code2,
  GitCommitHorizontal,
  Gauge,
  MonitorCheck,
  ShieldCheck,
  Sparkles,
  Wrench
} from "lucide-react";

const assessmentSignals = [
  {
    icon: ClipboardList,
    title: "Product understanding",
    body: "Can they turn a messy product ask into a sensible plan, scope, tradeoffs, and implementation path?"
  },
  {
    icon: Bot,
    title: "AI collaboration judgment",
    body: "Can they use coding agents productively without shipping hallucinated, unreviewed, or brittle work?"
  },
  {
    icon: Code2,
    title: "Codebase navigation",
    body: "Can they read an unfamiliar app, find the right seams, and make changes without wrecking adjacent behavior?"
  },
  {
    icon: Wrench,
    title: "Debugging discipline",
    body: "Can they inspect failures, form hypotheses, validate fixes, and keep a useful trail of what happened?"
  },
  {
    icon: MonitorCheck,
    title: "Testing and evals",
    body: "Can they add practical checks that prove the feature works and catch the mistakes AI tends to make?"
  },
  {
    icon: ShieldCheck,
    title: "Production readiness",
    body: "Can they consider reliability, edge cases, accessibility, security, and maintainability before calling it done?"
  }
];

const platformFlow = [
  "Paste a JD or role brief",
  "Generate a realistic task",
  "Invite candidates by email",
  "Candidate builds in a hosted workspace",
  "Every commit can trigger evals",
  "Review the evidence-rich report"
];

const evidenceRows = [
  ["Visible tests", "6/7 passed", "warning"],
  ["Hidden evals", "1/2 passed", "danger"],
  ["AI session trail", "captured", "ok"],
  ["Commits", "4 checkpoints", "ok"],
  ["Reviewer verdict", "lean no hire", "warning"]
];

const pricingPlans = [
  {
    name: "Free trial",
    price: "$0",
    detail: "5 started assessments included",
    cta: "Start with 5 free assessments",
    href: "/sign-up",
    featured: true,
    features: ["Magic-link candidate invites", "Hosted OpenCode workspace", "Automated evals", "PDF-ready reviewer report"]
  },
  {
    name: "Pay as you go",
    price: "$59",
    detail: "per started assessment",
    cta: "Buy assessment credits",
    href: "/sign-up",
    featured: false,
    features: ["Daytona devbox included", "DeepSeek OpenCode budget included", "Proctoring recording included", "Report emailed to reviewers"]
  },
  {
    name: "Volume",
    price: "$39-$49",
    detail: "per assessment in prepaid packs",
    cta: "Request volume pricing",
    href: "/sign-up",
    featured: false,
    features: ["50+ assessment packs", "Role-based task generation", "Reviewer seats", "ATS and retention controls"]
  }
];

export default function Home() {
  return (
    <main className="home">
      <section className="home-hero">
        <div className="home-hero-scene" aria-hidden="true">
          <div className="home-terminal-window">
            <div className="home-window-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="home-terminal-lines">
              <span>$ proofwork start sde2-product-build</span>
              <span>Provisioned workspace · Daytona</span>
              <span>OpenCode session captured</span>
              <span>Running visible tests...</span>
              <span>Commit checkpoint eval queued</span>
            </div>
          </div>
          <div className="home-report-window">
            <div>
              <span className="home-mini-label">Candidate report</span>
              <strong>54/100</strong>
              <small>No hire · needs stronger evals</small>
            </div>
            <div className="home-bars">
              <span style={{ width: "42%" }} />
              <span style={{ width: "78%" }} />
              <span style={{ width: "62%" }} />
              <span style={{ width: "36%" }} />
            </div>
          </div>
          <div className="home-browser-window">
            <span>App preview</span>
            <div />
          </div>
        </div>

        <nav className="home-nav" aria-label="Home navigation">
          <Link className="home-brand" href="/">
            <span className="home-brand-mark">
              <GitCommitHorizontal size={18} />
            </span>
            <span>Proofwork</span>
          </Link>
          <div className="home-nav-actions">
            <Link href="#signals">What we test</Link>
            <Link href="#report">Reports</Link>
            <Link href="#pricing">Pricing</Link>
            <Link className="button secondary" href="/sign-in">
              Sign in
            </Link>
          </div>
        </nav>

        <div className="home-hero-copy">
          <p className="eyebrow">Hire on proof of work</p>
          <h1>
            Skip the whiteboard. <em>Hire on proof of work.</em>
          </h1>
          <p>
            Proofwork replaces live coding rounds with real, async product tasks in a hosted dev workspace. Candidates plan, build,
            test, work with AI, and commit, leaving a complete evidence trail your reviewers can actually read.
          </p>
          <div className="home-hero-actions">
            <Link className="button" href="#pricing">
              Start free trial <ArrowRight size={16} />
            </Link>
            <a className="button secondary" href="#signals">
              See scoring factors
            </a>
          </div>
        </div>
      </section>

      <section className="home-band home-belief">
        <div className="home-section-heading">
          <p className="eyebrow">The old signal is fading</p>
          <h2>
            Puzzles are a narrow proxy for a <em>much bigger job.</em>
          </h2>
        </div>
        <div className="home-belief-grid">
          <div>
            <strong>What most platforms still test</strong>
            <p>Recall, speed under observation, LeetCode fluency, and how calmly someone performs while a human watches.</p>
          </div>
          <div>
            <strong>What modern teams need to know</strong>
            <p>
              Can this person take a real product problem, collaborate with AI, navigate an app, ship a maintainable change, and
              prove it works?
            </p>
          </div>
          <div>
            <strong>Where humans should spend time</strong>
            <p>
              Reviewing evidence, calibrating judgment, and making hiring decisions. Not sitting through another live coding screen.
            </p>
          </div>
        </div>
      </section>

      <section className="home-band" id="signals">
        <div className="home-section-heading">
          <p className="eyebrow">What Proofwork scores</p>
          <h2>
            The assessment <em>is</em> the work loop.
          </h2>
          <p>
            The best signal comes from watching the whole loop: intent, plan, build, verify, debug, communicate. Not one isolated
            coding trick.
          </p>
        </div>
        <div className="home-signal-grid">
          {assessmentSignals.map((signal) => {
            const Icon = signal.icon;
            return (
              <article className="home-signal" key={signal.title}>
                <Icon size={22} />
                <h3>{signal.title}</h3>
                <p>{signal.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-band home-workflow">
        <div className="home-section-heading">
          <p className="eyebrow">No live interviewer required</p>
          <h2>Give candidates a real workspace. Get reviewers a real decision packet.</h2>
        </div>
        <div className="home-flow">
          {platformFlow.map((item, index) => (
            <div className="home-flow-step" key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="home-band home-report-section" id="report">
        <div className="home-report-copy">
          <p className="eyebrow">Evidence over vibes</p>
          <h2>
            A reviewer report that <em>explains</em> the call.
          </h2>
          <p>
            Each attempt produces a PDF-ready scorecard with candidate details, role, section scores, tests, hidden evals, commits,
            AI collaboration traces, timeline, proctoring events, and reviewer override.
          </p>
          <div className="home-proof-points">
            <span>
              <CheckCircle2 size={16} /> Candidate name, email, position
            </span>
            <span>
              <CheckCircle2 size={16} /> Section-by-section performance
            </span>
            <span>
              <CheckCircle2 size={16} /> Clear hire recommendation
            </span>
          </div>
        </div>
        <div className="home-report-card" aria-label="Sample candidate evidence report">
          <div className="home-report-card-header">
            <div>
              <span className="home-mini-label">Candidate</span>
              <strong>Candidate A</strong>
              <small>Product engineer · AI workflow assessment</small>
            </div>
            <span className="status amber">Lean no hire</span>
          </div>
          <div className="home-score-ring">
            <Gauge size={30} />
            <strong>68</strong>
            <span>overall score</span>
          </div>
          <div className="home-evidence-table">
            {evidenceRows.map(([label, value, status]) => (
              <div key={label}>
                <span className={`home-evidence-dot ${status}`} />
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-band home-pricing" id="pricing">
        <div className="home-section-heading">
          <p className="eyebrow">Pricing</p>
          <h2>Price per assessment, not per seat.</h2>
          <p>
            Proofwork charges one assessment credit when a candidate starts the timed workspace. Invitations are free; the credit
            covers infrastructure, AI coding access, evals, proctoring capture, artifacts, and the reviewer report.
          </p>
        </div>
        <div className="home-pricing-grid">
          {pricingPlans.map((plan) => (
            <article className={plan.featured ? "home-pricing-card featured" : "home-pricing-card"} key={plan.name}>
              <div className="home-pricing-card-header">
                <BadgeDollarSign size={22} />
                <span className="status green">{plan.name}</span>
              </div>
              <strong>{plan.price}</strong>
              <p>{plan.detail}</p>
              <a className={plan.featured ? "button" : "button secondary"} href={plan.href}>
                {plan.cta}
              </a>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <CheckCircle2 size={16} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="home-final">
        <Sparkles size={22} />
        <h2>
          Less trivia night. <em>More trial project.</em>
        </h2>
        <p>
          Give candidates room to show real judgment, and give your hiring team structured evidence without burning interviewer
          hours.
        </p>
        <Link className="button" href="#pricing">
          Start with 5 free assessments <ArrowRight size={16} />
        </Link>
        <Link className="button secondary" href="/sign-in">
          Sign in to dashboard
        </Link>
      </section>
    </main>
  );
}
