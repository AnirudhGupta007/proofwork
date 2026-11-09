import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { generateAssessmentFromJd, type AssessmentGenerationInput } from "../app/lib/assessment-generator.ts";
import { preflightAssessmentWorkspace } from "../app/lib/assessment-preflight.ts";

const db = new PrismaClient();

type SampleAssessment = {
  key: string;
  category: "generated-code-jd" | "new-project";
  input: AssessmentGenerationInput;
};

const samples: SampleAssessment[] = [
  {
    key: "ai-support-triage-existing",
    category: "generated-code-jd",
    input: {
      roleTitle: "SDE2 Product Engineer",
      level: "SDE2",
      durationMin: 180,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Own an AI support workflow end-to-end. The engineer should talk to users, identify recurring support pain, ship product improvements, add evals, and use coding agents without blindly accepting one-shot output.",
      projectBrief:
        "Generate a runnable support triage starter app with messy support tickets, customer snippets, and an assistant panel that needs a clearer workflow.",
      assessmentPrompt:
        "Test user discovery judgment, product taste, scoped implementation, prompt quality, eval design, and clear tradeoff communication.",
      assessmentIdeaDetails: {
        id: "support-triage-existing",
        title: "SDE2 Support Triage Copilot Sprint",
        summary:
          "Improve a generated support triage app so operators can group customer issues, choose one action, and verify assistant recommendations with evidence.",
        durationMin: 180,
        evaluationFocus: ["user discovery judgment", "workflow design", "AI collaboration", "eval quality", "production readiness"],
        deliverables: ["PLAN.md", "support issue grouping UI", "assistant evidence behavior", "triage eval", "iteration memo"]
      }
    }
  },
  {
    key: "reviewer-feedback-existing",
    category: "generated-code-jd",
    input: {
      roleTitle: "SDE2 Full-Stack Engineer",
      level: "SDE2",
      durationMin: 180,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Build reviewer-facing hiring software with strong product judgment. The engineer should navigate a TypeScript app, improve reviewer workflows, write tests, and communicate tradeoffs clearly.",
      projectBrief:
        "Generate a Proofwork-style reviewer dashboard starter with candidate reports, feedback snippets, and missing triage behavior.",
      assessmentPrompt:
        "Test codebase navigation, reviewer workflow design, full-stack state handling, tests, evals, and what-not-to-build judgment.",
      assessmentIdeaDetails: {
        id: "reviewer-feedback-existing",
        title: "SDE2 Reviewer Feedback Triage Panel",
        summary:
          "Add a feedback triage panel to a generated reviewer dashboard so hiring teams can classify candidate/report feedback without overbuilding workflow automation.",
        durationMin: 180,
        evaluationFocus: ["codebase navigation", "product UI workflow", "state persistence", "test strategy", "communication"],
        deliverables: ["PLAN.md", "feedback triage panel", "status persistence", "grouping tests", "scope rejection notes"]
      }
    }
  },
  {
    key: "billing-alerts-existing",
    category: "generated-code-jd",
    input: {
      roleTitle: "SDE2 Platform Engineer",
      level: "SDE2",
      durationMin: 180,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Own reliability and billing surfaces for a usage-based AI product. The engineer should build understandable customer-facing workflows, protect against edge cases, and verify behavior with deterministic tests.",
      projectBrief:
        "Generate a billing usage starter app with plans, credits, failed payment states, and confusing customer support snippets.",
      assessmentPrompt:
        "Test pragmatic platform UX, state modeling, reliability thinking, tests for edge cases, and customer communication.",
      assessmentIdeaDetails: {
        id: "billing-alerts-existing",
        title: "SDE2 Usage Credits And Billing Recovery",
        summary:
          "Improve a generated billing dashboard so admins understand assessment credits, failed payments, and recovery actions without contacting support.",
        durationMin: 180,
        evaluationFocus: ["state modeling", "edge-case handling", "customer-facing UX", "test coverage", "production readiness"],
        deliverables: ["PLAN.md", "credit usage panel", "failed-payment recovery state", "billing tests", "risk notes"]
      }
    }
  },
  {
    key: "agent-observability-existing",
    category: "generated-code-jd",
    input: {
      roleTitle: "SDE2 AI Infrastructure Engineer",
      level: "SDE2",
      durationMin: 210,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Build observability for AI-agent workflows. The engineer should understand latency, logs, prompt quality, and failure modes, then ship tools that help reviewers trust what happened.",
      projectBrief:
        "Generate an agent session observability starter with terminal logs, model latency events, prompt snippets, and missing reviewer insights.",
      assessmentPrompt:
        "Test debugging discipline, observability design, eval quality, AI collaboration judgment, and production readiness.",
      assessmentIdeaDetails: {
        id: "agent-observability-existing",
        title: "SDE2 Agent Session Observability Workbench",
        summary:
          "Build a focused observability view for AI coding sessions that separates model latency, command failures, prompt quality, and reviewer evidence.",
        durationMin: 210,
        evaluationFocus: ["debugging discipline", "observability UX", "AI collaboration", "eval quality", "production readiness"],
        deliverables: ["PLAN.md", "session timeline", "latency/error grouping", "prompt-quality eval", "verification notes"]
      }
    }
  },
  {
    key: "enterprise-onboarding-existing",
    category: "generated-code-jd",
    input: {
      roleTitle: "SDE2 Frontend Product Engineer",
      level: "SDE2",
      durationMin: 180,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Ship polished onboarding and setup flows for B2B customers. The engineer should reduce confusion, write maintainable frontend code, handle validation, and verify the happy path plus failure states.",
      projectBrief:
        "Generate an employer onboarding starter with company details, assessment setup, team invites, and unclear next steps.",
      assessmentPrompt:
        "Test interaction design, frontend implementation quality, validation/error states, test discipline, and communication.",
      assessmentIdeaDetails: {
        id: "enterprise-onboarding-existing",
        title: "SDE2 Employer Onboarding Flow Repair",
        summary:
          "Improve a generated employer onboarding flow so a hiring admin can set up company details, invite teammates, and reach the dashboard with clear state and validation.",
        durationMin: 180,
        evaluationFocus: ["interaction design", "frontend quality", "validation behavior", "test strategy", "communication"],
        deliverables: ["PLAN.md", "onboarding flow", "validation states", "frontend tests", "final verification notes"]
      }
    }
  },
  {
    key: "greenfield-ai-meeting-copilot",
    category: "new-project",
    input: {
      roleTitle: "SDE2 Product Engineer",
      level: "SDE2",
      durationMin: 210,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Act as a one-person product team. Discover the user problem, design the first useful product surface, implement it, verify it, and explain the next iteration using AI coding agents thoughtfully.",
      projectBrief:
        "Create a new AI meeting follow-up copilot for founder/customer calls. It should turn raw notes into decisions, commitments, risks, and next actions with source evidence.",
      assessmentPrompt:
        "Test greenfield product shaping, UX taste, end-to-end implementation, eval design for AI output quality, and iteration judgment.",
      assessmentIdeaDetails: {
        id: "greenfield-ai-meeting-copilot",
        title: "SDE2 AI Meeting Follow-Up Copilot",
        summary:
          "Build a new product slice that turns messy founder/customer call notes into a trusted follow-up plan with source-backed decisions and next actions.",
        durationMin: 210,
        evaluationFocus: ["product shaping", "AI output quality", "UX taste", "eval design", "iteration judgment"],
        deliverables: ["PLAN.md", "new product workflow", "source-backed AI output", "quality eval", "iteration memo"]
      }
    }
  },
  {
    key: "greenfield-recruiter-workbench",
    category: "new-project",
    input: {
      roleTitle: "SDE2 Full-Stack Product Engineer",
      level: "SDE2",
      durationMin: 210,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Build hiring products end-to-end. The engineer should turn vague recruiter needs into a focused workflow, ship a useful full-stack slice, add tests/evals, and make tradeoffs visible.",
      projectBrief:
        "Create a recruiter assessment planning workbench where a recruiter pastes a JD and gets assessment options, risks, and a recommended interview flow.",
      assessmentPrompt:
        "Test ambiguous requirements handling, data modeling, workflow clarity, full-stack execution, eval quality, and communication.",
      assessmentIdeaDetails: {
        id: "greenfield-recruiter-workbench",
        title: "SDE2 Recruiter Assessment Planning Workbench",
        summary:
          "Build a new workflow that converts a pasted JD into assessment options, screening signals, and a recommended invite plan for a hiring team.",
        durationMin: 210,
        evaluationFocus: ["requirements judgment", "workflow design", "full-stack implementation", "eval quality", "communication"],
        deliverables: ["PLAN.md", "JD-to-assessment workflow", "recommendation state", "behavior tests", "tradeoff notes"]
      }
    }
  },
  {
    key: "greenfield-trust-review",
    category: "new-project",
    input: {
      roleTitle: "Senior SDE Product Engineer",
      level: "Senior SDE",
      durationMin: 240,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Own sensitive AI product surfaces where users need to trust decisions. The engineer should design guardrails, instrument quality, and explain production risks like a product-minded technical lead.",
      projectBrief:
        "Create a trust review dashboard for AI-generated candidate reports. It should surface evidence gaps, confidence, human overrides, and risky automated conclusions.",
      assessmentPrompt:
        "Test senior-level product architecture, guardrails, evidence design, production risk judgment, eval quality, and communication.",
      assessmentIdeaDetails: {
        id: "greenfield-trust-review",
        title: "Senior SDE AI Report Trust Review",
        summary:
          "Build a new trust-review surface for AI candidate reports that helps admins inspect evidence gaps, confidence, overrides, and risky conclusions before sharing.",
        durationMin: 240,
        evaluationFocus: ["system design judgment", "AI guardrails", "evidence UX", "production readiness", "senior communication"],
        deliverables: ["PLAN.md", "trust review dashboard", "risk/override workflow", "guardrail eval", "architecture notes"]
      }
    }
  },
  {
    key: "greenfield-pm-eval-builder",
    category: "new-project",
    input: {
      roleTitle: "AI Product Manager",
      level: "Product Manager",
      durationMin: 150,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Own AI product quality and launch decisions. The PM should define what good output means, design realistic evals, prioritize scope, and communicate a clear ship/no-ship recommendation.",
      projectBrief:
        "Create a product eval builder for an AI assistant. The candidate should define quality dimensions, sample cases, pass thresholds, and a launch decision workflow.",
      assessmentPrompt:
        "Test product judgment, eval design, prioritization, user empathy, risk framing, and decision clarity.",
      assessmentIdeaDetails: {
        id: "greenfield-pm-eval-builder",
        title: "AI Product Manager Eval Builder",
        summary:
          "Design a new product-eval workspace for an AI assistant, including quality criteria, sample scenarios, pass thresholds, risks, and launch recommendation.",
        durationMin: 150,
        evaluationFocus: ["eval design", "product judgment", "prioritization", "risk framing", "decision clarity"],
        deliverables: ["quality rubric", "eval cases", "thresholds", "launch decision", "risk memo"]
      }
    }
  },
  {
    key: "greenfield-customer-success-ai",
    category: "new-project",
    input: {
      roleTitle: "SDE1 Product Engineer",
      level: "SDE1",
      durationMin: 150,
      proctoringEnabled: true,
      repoSource: "generated",
      jobDescription:
        "Build small useful product slices with AI assistance. The engineer should follow a plan, ask good questions, implement a focused UI/API behavior, and verify the work with tests.",
      projectBrief:
        "Create a customer success assistant that summarizes account health from usage notes and suggests one next action with visible reasoning.",
      assessmentPrompt:
        "Test scoped execution, UI clarity, basic state/API behavior, test discipline, prompt hygiene, and final communication.",
      assessmentIdeaDetails: {
        id: "greenfield-customer-success-ai",
        title: "SDE1 Customer Success Next Action Assistant",
        summary:
          "Build a small new assistant workflow that reads account notes, summarizes customer health, and recommends one next action with supporting evidence.",
        durationMin: 150,
        evaluationFocus: ["scoped execution", "UI clarity", "API correctness", "test discipline", "communication"],
        deliverables: ["PLAN.md", "account health workflow", "next-action output", "basic tests", "final verification notes"]
      }
    }
  }
];

async function main() {
  const organization =
    (await db.organization.findFirst({ where: { slug: "demo" } })) ??
    (await db.organization.findFirst({ where: { slug: "default" } }));

  if (!organization) throw new Error("No organization found. Complete onboarding before creating assessments.");

  const created: Array<{ key: string; title: string; category: string; preflight: boolean }> = [];

  for (const sample of samples) {
    const generated = generateAssessmentFromJd(sample.input);
    const evaluationPlan = generated.evaluationPlan as {
      focus?: string[];
      requiredEvidence?: string[];
      assessmentMode?: string;
      [key: string]: unknown;
    };
    const preflight = await preflightAssessmentWorkspace({
      title: generated.title,
      roleTitle: generated.roleTitle,
      level: generated.level,
      instructions: generated.instructions,
      taskBrief: generated.taskBrief,
      evaluationFocus: evaluationPlan.focus ?? [],
      requiredEvidence: evaluationPlan.requiredEvidence ?? [],
      assessmentMode: evaluationPlan.assessmentMode
    });

    if (!preflight.passed) {
      throw new Error(`Preflight failed for ${sample.key}: ${preflight.stderr || preflight.stdout}`);
    }

    const enrichedPlan = {
      ...evaluationPlan,
      sampleKey: sample.key,
      sampleCategory: sample.category,
      generatedStarterRepo: true,
      createdBySeed: "scripts/create-sample-assessments.ts",
      currentEvals: [
        "starter repo health check",
        "visible npm test suite",
        "generated TASK.md/EVALS.md quality expectations",
        "commit checkpoint eval hook"
      ],
      expectedEvals: evaluationPlan.requiredEvidence ?? [],
      preflight
    };

    const existing = await db.assessmentTemplate.findFirst({
      where: {
        organizationId: organization.id,
        title: generated.title,
        roleTitle: generated.roleTitle,
        level: generated.level
      }
    });

    const data = {
      organizationId: organization.id,
      title: generated.title,
      roleTitle: generated.roleTitle,
      level: generated.level,
      durationMin: generated.durationMin,
      repoUrl: generated.repoUrl,
      instructions: generated.instructions,
      generatedFromJd: generated.generatedFromJd,
      taskBrief: generated.taskBrief,
      evaluationPlan: enrichedPlan as Prisma.InputJsonValue,
      proctoringConfig: generated.proctoringConfig as Prisma.InputJsonValue,
      rubric: generated.rubric as Prisma.InputJsonValue,
      isActive: false
    };

    const template = existing
      ? await db.assessmentTemplate.update({ where: { id: existing.id }, data })
      : await db.assessmentTemplate.create({ data });

    created.push({
      key: sample.key,
      title: template.title,
      category: sample.category,
      preflight: preflight.passed
    });
  }

  console.log(JSON.stringify({ organization: organization.slug, created }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
