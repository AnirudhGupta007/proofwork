import { defaultRubric } from "./domain/score.ts";
import { normalizedAssessmentRole } from "./domain/role-detection.ts";

export type AssessmentGenerationInput = {
  roleTitle: string;
  level: string;
  jobDescription: string;
  durationMin?: number;
  proctoringEnabled?: boolean;
  repoSource?: "generated" | "github";
  repoUrl?: string;
  projectBrief?: string;
  existingProjectBrief?: string;
  assessmentIdea?: string;
  assessmentIdeaDetails?: AssessmentIdea;
  assessmentPrompt?: string;
  assessmentMode?: "solo" | "live_guided";
};

export type AssessmentIdea = {
  id: string;
  title: string;
  summary: string;
  durationMin: number;
  evaluationFocus: string[];
  deliverables: string[];
};

function levelTitlePrefix(level: string) {
  return ["mid", "middle"].includes(level.trim().toLowerCase()) ? "" : `${level} `;
}

function engineeringIdeas(level: string): AssessmentIdea[] {
  const prefix = levelTitlePrefix(level);
  return [
    {
      id: "product-build",
      title: `${prefix}AI Product Build`,
      summary: "Build a focused AI chat workspace from a product brief, including UI, API behavior, evals, and verification notes.",
      durationMin: 120,
      evaluationFocus: ["product understanding", "full-stack implementation", "AI collaboration", "eval quality", "production readiness"],
      deliverables: ["PLAN.md", "usable product slice", "message API", "behavior eval", "final verification notes"]
    },
    {
      id: "eval-debugging",
      title: `${prefix}Reliability And Evals Sprint`,
      summary: "Take a partially working AI feature, diagnose failures, improve deterministic tests/evals, and stabilize the experience.",
      durationMin: 120,
      evaluationFocus: ["debugging discipline", "test strategy", "codebase navigation", "root-cause analysis", "communication"],
      deliverables: ["failure analysis", "bug fixes", "visible tests", "hidden-eval readiness", "risk notes"]
    },
    {
      id: "agentic-workflow",
      title: `${prefix}Agentic Workflow Feature`,
      summary: "Design and implement a workflow where an assistant helps users turn ambiguous intent into structured product output.",
      durationMin: 150,
      evaluationFocus: ["requirements judgment", "interaction design", "state management", "AI guardrails", "maintainability"],
      deliverables: ["workflow plan", "interactive UI", "assistant behavior", "guardrail eval", "launch notes"]
    }
  ];
}

function generatedProjectEngineeringIdeas(level: string): AssessmentIdea[] {
  const prefix = levelTitlePrefix(level);
  return [
    {
      id: "greenfield-product-slice",
      title: `${prefix}New Product Build Sprint`,
      summary:
        "Start from the employer's product brief and build a small, complete app surface with generated sample data, UI, API behavior, evals, and launch notes.",
      durationMin: 120,
      evaluationFocus: ["product shaping", "full-stack execution", "UX judgment", "eval design", "shipping discipline"],
      deliverables: ["PLAN.md", "generated app workflow", "sample data model", "behavior tests/evals", "launch and tradeoff notes"]
    },
    {
      id: "greenfield-ai-workflow",
      title: `${prefix}AI Workflow From Blank Slate`,
      summary:
        "Create a new AI-assisted workflow from a rough idea, including the first-run experience, assistant guardrails, deterministic evals, and a reviewable app preview.",
      durationMin: 150,
      evaluationFocus: ["ambiguous requirements", "AI product behavior", "interaction design", "guardrail quality", "verification"],
      deliverables: ["workflow plan", "usable AI product surface", "prompt or policy design", "eval harness", "final verification memo"]
    },
    {
      id: "greenfield-operator-dashboard",
      title: `${prefix}Operator Dashboard Build`,
      summary:
        "Design and implement a new operational dashboard from provided messy inputs, deciding the core objects, state transitions, empty states, and eval checks.",
      durationMin: 120,
      evaluationFocus: ["data modeling", "interface clarity", "scope control", "state management", "production readiness"],
      deliverables: ["domain model notes", "working dashboard", "state/update behavior", "empty/error states", "tests/evals"]
    }
  ];
}

function existingCodebaseIdeas(level: string, role: string): AssessmentIdea[] {
  const prefix = levelTitlePrefix(level);
  if (role === "product") {
    return [
      {
        id: "existing-product-audit",
        title: `${prefix}Existing Product Review Sprint`,
        summary:
          "Work inside the linked product repo as a reviewer: map the current flow, identify one high-leverage product gap, define an experiment, and produce implementation-ready acceptance criteria.",
        durationMin: 120,
        evaluationFocus: ["codebase-informed product judgment", "scope control", "metrics", "risk handling", "communication"],
        deliverables: ["repo walkthrough notes", "product gap diagnosis", "prioritized scope", "success metric", "implementation-ready brief"]
      },
      {
        id: "existing-eval-strategy",
        title: `${prefix}Existing AI Feature Eval Plan`,
        summary:
          "Inspect an existing AI workflow in the repo and design a practical eval plan that catches failure modes without asking engineers to rebuild the product.",
        durationMin: 120,
        evaluationFocus: ["eval design", "repo comprehension", "quality bar", "launch readiness", "decision clarity"],
        deliverables: ["feature map", "failure-mode list", "eval rubric", "test scenarios", "go/no-go recommendation"]
      }
    ];
  }

  return [
    {
      id: "existing-codebase-feature",
      title: `${prefix}Existing Repo Feature Integration`,
      summary:
        "Clone the linked repo, understand its architecture, and ship one scoped feature inside the existing patterns without rewriting the app.",
      durationMin: 120,
      evaluationFocus: ["codebase navigation", "scoped implementation", "integration judgment", "test coverage", "maintainability"],
      deliverables: ["repo map", "PLAN.md", "integrated feature", "tests/evals in repo style", "tradeoff notes"]
    },
    {
      id: "existing-reliability-evals",
      title: `${prefix}Existing Repo Reliability And Evals Sprint`,
      summary:
        "Find a fragile behavior in the existing repo, root-cause it, improve tests or evals, and make the smallest maintainable fix.",
      durationMin: 150,
      evaluationFocus: ["debugging discipline", "root-cause analysis", "repo-specific verification", "regression coverage", "communication"],
      deliverables: ["failure analysis", "small fix", "regression test/eval", "command output", "risk notes"]
    },
    {
      id: "existing-ux-surgery",
      title: `${prefix}Existing Product UX Surgery`,
      summary:
        "Improve a confusing product flow in the linked repo while preserving the existing design and data model, then verify the behavior in browser and tests.",
      durationMin: 120,
      evaluationFocus: ["product taste in existing UI", "implementation restraint", "state handling", "browser verification", "code quality"],
      deliverables: ["flow critique", "focused UX change", "state/API update", "browser evidence", "tests/evals"]
    }
  ];
}

function productIdeas(level: string): AssessmentIdea[] {
  const prefix = levelTitlePrefix(level);
  return [
    {
      id: "pm-strategy",
      title: `${prefix}AI Product Strategy Simulation`,
      summary: "Create a product strategy workspace for an AI product with users, scope, risks, metrics, and launch sequencing.",
      durationMin: 120,
      evaluationFocus: ["problem framing", "prioritization", "metrics", "risk handling", "communication"],
      deliverables: ["PRD-style plan", "target users", "MVP scope", "success metrics", "risk register"]
    },
    {
      id: "pm-evals",
      title: `${prefix}Product Evals Design`,
      summary: "Define how the team should evaluate an AI product for usefulness, reliability, safety, and launch readiness.",
      durationMin: 120,
      evaluationFocus: ["eval design", "quality bar", "user insight", "tradeoffs", "decision clarity"],
      deliverables: ["eval rubric", "test scenarios", "success thresholds", "review cadence", "final recommendation"]
    },
    {
      id: "pm-launch",
      title: `${prefix}Launch Readiness Review`,
      summary: "Assess an AI feature concept, identify release blockers, prioritize fixes, and produce a launch/no-launch decision.",
      durationMin: 120,
      evaluationFocus: ["judgment", "risk prioritization", "stakeholder communication", "metrics", "execution planning"],
      deliverables: ["launch brief", "blocker list", "metric plan", "rollout plan", "decision memo"]
    }
  ];
}

function productEngineerAgentIdeas(level: string, repoSource?: AssessmentGenerationInput["repoSource"]): AssessmentIdea[] {
  const prefix = level && !["mid", "product manager"].includes(level.toLowerCase()) ? `${level} ` : "";
  if (repoSource === "github") {
    return [
      {
        id: "existing-agentic-product-improvement",
        title: `${prefix}Existing Repo Agentic Product Improvement`,
        summary:
          "Work inside the linked product repo, use coding agents to understand the codebase, and ship one product improvement that fits the current architecture.",
        durationMin: 120,
        evaluationFocus: ["repo navigation", "agent orchestration", "product taste", "integration judgment", "verification quality"],
        deliverables: ["repo map", "agent work plan", "scoped product change", "tests/evals", "final shipping summary"]
      },
      {
        id: "existing-user-feedback-iteration",
        title: `${prefix}Existing Repo User Feedback Iteration`,
        summary:
          "Use realistic user feedback to choose one improvement in the existing repo, reject distracting scope, implement it, and document the next iteration.",
        durationMin: 120,
        evaluationFocus: ["user discovery judgment", "scope control", "existing-code UX taste", "shipping discipline", "iteration judgment"],
        deliverables: ["feedback synthesis", "no-build decisions", "repo-native implementation", "verification/eval evidence", "iteration memo"]
      },
      {
        id: "existing-multi-agent-merge",
        title: `${prefix}Existing Repo Multi-Agent Merge Sprint`,
        summary:
          "Run parallel agent investigations against the existing codebase, merge the useful output into one coherent product change, and verify it without creating architectural drift.",
        durationMin: 150,
        evaluationFocus: ["parallel agent management", "merge judgment", "architecture restraint", "code quality", "communication"],
        deliverables: ["parallel prompt log", "accepted/rejected agent output", "integrated repo change", "tests/evals", "risk notes"]
      }
    ];
  }

  return [
    {
      id: "one-person-product-team",
      title: `${prefix}One-Person Product Team Sprint`,
      summary:
        "Turn messy user conversations and a vague product opportunity into a shipped product slice with UX, implementation, evals, and an iteration plan.",
      durationMin: 150,
      evaluationFocus: [
        "user discovery judgment",
        "product taste",
        "end-to-end shipping",
        "agent orchestration",
        "iteration discipline",
        "what-not-to-build judgment"
      ],
      deliverables: [
        "user-insight notes",
        "PLAN.md with no-build decisions",
        "working product surface",
        "agent orchestration log",
        "eval or telemetry check",
        "iteration memo"
      ]
    },
    {
      id: "multi-agent-shipping-loop",
      title: `${prefix}Multi-Agent Shipping Loop`,
      summary:
        "Use multiple coding agents in parallel to explore, implement, verify, and polish a product improvement without letting the outputs conflict.",
      durationMin: 120,
      evaluationFocus: [
        "problem decomposition",
        "parallel agent management",
        "merge judgment",
        "verification quality",
        "code and UX taste",
        "communication"
      ],
      deliverables: [
        "agent work plan",
        "parallel prompt log",
        "integrated product change",
        "conflict-resolution notes",
        "tests/evals",
        "final shipping summary"
      ]
    },
    {
      id: "user-feedback-iteration",
      title: `${prefix}User Feedback To Loved Feature`,
      summary:
        "Review realistic support threads, decide what matters, improve the product surface, instrument success, and explain the next iteration.",
      durationMin: 120,
      evaluationFocus: [
        "talk-to-users mindset",
        "prioritization",
        "UX taste",
        "fast prototyping",
        "measurement",
        "launch tradeoffs"
      ],
      deliverables: [
        "feedback synthesis",
        "prioritized scope",
        "product prototype",
        "success metric or event",
        "eval/QA checklist",
        "launch/no-launch note"
      ]
    },
    {
      id: "taste-and-product-surgery",
      title: `${prefix}Product Taste Surgery`,
      summary:
        "Take a functional but unloved interface, identify why it is bad, redesign the core flow, ship improvements, and defend the taste decisions.",
      durationMin: 150,
      evaluationFocus: ["product taste", "interface critique", "execution speed", "UX implementation", "judgment under ambiguity"],
      deliverables: ["critique memo", "before/after product flow", "implemented UX improvement", "verification notes", "taste rationale"]
    }
  ];
}

function projectContext(input: AssessmentGenerationInput) {
  const generatedBrief = input.projectBrief?.trim();
  const existingBrief = input.existingProjectBrief?.trim();
  if (input.repoSource === "github") {
    return [
      "Project mode: existing codebase.",
      input.repoUrl?.trim() ? `Repository: ${input.repoUrl.trim()}.` : "",
      existingBrief ? `Desired candidate work: ${existingBrief}` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Project mode: new project from employer brief.",
    generatedBrief ? `Employer project brief: ${generatedBrief}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function isProductEngineerAgentRole(input: AssessmentGenerationInput) {
  const combined = `${input.roleTitle} ${input.jobDescription} ${input.assessmentPrompt ?? ""} ${projectContext(input)}`.toLowerCase();
  return (
    /one-person product team|coding agents?|claude code|codex|opencode|ship(ping)? to production|talk to users|product surface|strong taste|what not to build|mostly solo|agent workflow|parallel agents/.test(
      combined
    ) && /engineer|builder|product/.test(combined)
  );
}

export function generateAssessmentIdeasFromJd(input: AssessmentGenerationInput) {
  const role = normalizedAssessmentRole(input.roleTitle, input.jobDescription);
  const level = input.level || "Mid";
  const prefix = levelTitlePrefix(level);
  const agentProductRole = isProductEngineerAgentRole(input);
  const baseIdeas =
    input.repoSource === "github"
      ? agentProductRole
        ? productEngineerAgentIdeas(level, input.repoSource)
        : existingCodebaseIdeas(level, role)
      : agentProductRole
        ? productEngineerAgentIdeas(level, input.repoSource)
        : role === "product"
          ? productIdeas(level)
          : generatedProjectEngineeringIdeas(level);
  const prompt = [input.assessmentPrompt?.trim(), projectContext(input)].filter(Boolean).join("\n\n");
  const liveIdea: AssessmentIdea | null =
    input.assessmentMode === "live_guided"
      ? {
          id: "live-guided-session",
          title: `${prefix}Live Guided Work Session`,
          summary:
            "A company engineer joins the session, asks follow-up questions, gives light guidance, and the transcript is scored with the work evidence.",
          durationMin: input.durationMin ?? 120,
          evaluationFocus: [
            "collaborative problem solving",
            "clarifying questions",
            "response to feedback",
            "technical communication",
            "implementation evidence"
          ],
          deliverables:
            role === "product"
              ? ["decision memo", "live discussion transcript", "prioritized scope", "risk tradeoffs", "final recommendation"]
              : ["PLAN.md", "working product slice", "live discussion transcript", "tests or evals", "final verification notes"]
        }
      : null;

  if (!prompt) return baseIdeas;

  return [
    ...(liveIdea ? [liveIdea] : []),
    {
      id: "custom-focus",
      title: input.repoSource === "github" ? `${prefix}Existing Repo Custom Work Simulation` : `${prefix}New Project Custom Work Simulation`,
      summary:
        input.repoSource === "github"
          ? `Work inside the linked existing codebase. Tailored around: ${prompt}`
          : `Build a new generated project/workflow. Tailored around: ${prompt}`,
      durationMin: input.durationMin ?? baseIdeas[0]?.durationMin ?? 120,
      evaluationFocus: focusFromPrompt(prompt, role),
      deliverables: deliverablesFromPrompt(prompt, role)
    },
    ...baseIdeas
  ];
}

function focusFromPrompt(prompt: string, role: string) {
  const lower = prompt.toLowerCase();
  const focus = new Set<string>();
  if (lower.includes("user") || lower.includes("support") || lower.includes("whatsapp") || lower.includes("discovery")) focus.add("user discovery judgment");
  if (lower.includes("taste") || lower.includes("loved") || lower.includes("interface")) focus.add("product taste");
  if (lower.includes("parallel") || lower.includes("agent")) focus.add("agent orchestration");
  if (lower.includes("ship") || lower.includes("production")) focus.add("shipping discipline");
  if (lower.includes("what not") || lower.includes("not to build") || lower.includes("prioritize")) focus.add("prioritization");
  if (lower.includes("system") || lower.includes("architecture")) focus.add("system design judgment");
  if (lower.includes("frontend") || lower.includes("ui") || lower.includes("ux")) focus.add("product UI workflow");
  if (lower.includes("backend") || lower.includes("api")) focus.add("API correctness");
  if (lower.includes("eval") || lower.includes("quality")) focus.add("eval quality");
  if (lower.includes("agent") || lower.includes("ai")) focus.add("AI collaboration");
  if (lower.includes("data") || lower.includes("analytics")) focus.add("data reasoning");
  if (lower.includes("stakeholder") || lower.includes("strategy") || role === "product") focus.add("decision clarity");
  focus.add("communication");
  focus.add("production readiness");
  return Array.from(focus).slice(0, 6);
}

function deliverablesFromPrompt(prompt: string, role: string) {
  if (role === "product") {
    return ["decision memo", "prioritized scope", "success metrics", "risk register", "evaluation plan", "final recommendation"];
  }

  const lower = prompt.toLowerCase();
  const deliverables = ["PLAN.md", "working product slice", "tests or evals", "commit history", "final verification notes"];
  if (lower.includes("user") || lower.includes("support") || lower.includes("whatsapp")) deliverables.splice(1, 0, "user feedback synthesis");
  if (lower.includes("parallel") || lower.includes("agent")) deliverables.splice(2, 0, "agent orchestration log");
  if (lower.includes("taste") || lower.includes("loved")) deliverables.splice(2, 0, "product taste rationale");
  if (lower.includes("ship") || lower.includes("production")) deliverables.splice(3, 0, "launch and iteration plan");
  if (lower.includes("frontend") || lower.includes("ui")) deliverables.splice(2, 0, "polished UI workflow");
  if (lower.includes("backend") || lower.includes("api")) deliverables.splice(2, 0, "implemented API behavior");
  if (lower.includes("data")) deliverables.splice(2, 0, "data model or analytics surface");
  return Array.from(new Set(deliverables));
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function generatedRepoUrl(title: string, roleTitle: string, level: string) {
  const repoSlug = slug(`${roleTitle}-${level}-${title}`) || "proofwork-generated-assessment";
  return `proofwork-generated://${repoSlug}`;
}

function projectSetupInstructions(input: AssessmentGenerationInput) {
  if (input.repoSource === "github" && input.repoUrl?.trim()) {
    return [
      "Project setup:",
      `- You are working inside an existing GitHub codebase: ${input.repoUrl.trim()}.`,
      "- Start by reading the repo README plus Proofwork's TASK.md and EVALS.md.",
      input.existingProjectBrief?.trim() ? `- Employer intent for this repo: ${input.existingProjectBrief.trim()}` : "",
      "- Keep the change scoped to the existing architecture and explain any repo assumptions you make.",
      ""
    ].filter(Boolean);
  }

  return [
    "Project setup:",
    "- You are working in a generated starter repo for a new product/workflow assessment.",
    input.projectBrief?.trim() ? `- Employer product idea: ${input.projectBrief.trim()}` : "",
    "- Treat the starter repo, sample data, README.md, TASK.md, and EVALS.md as the source of truth.",
    "- You may shape the product direction, but keep the shipped slice small enough to verify well.",
    ""
  ].filter(Boolean);
}

function taskForRole(role: string, level: string, assessmentIdea?: string, assessmentPrompt?: string, durationMin?: number, input?: AssessmentGenerationInput) {
  const prefix = levelTitlePrefix(level);
  const ideas = generateAssessmentIdeasFromJd({
    roleTitle: input?.roleTitle ?? (role === "product" ? "Product Manager" : "Software Development Engineer"),
    level,
    jobDescription: input?.jobDescription ?? assessmentPrompt ?? role,
    assessmentPrompt,
    durationMin,
    repoSource: input?.repoSource,
    repoUrl: input?.repoUrl,
    projectBrief: input?.projectBrief,
    existingProjectBrief: input?.existingProjectBrief,
    assessmentMode: input?.assessmentMode
  });
  const idea = input?.assessmentIdeaDetails ?? ideas.find((item) => item.id === assessmentIdea);
  const agentProductRole = input ? isProductEngineerAgentRole(input) : false;
  const titleForRepo = idea?.title ?? `${prefix}${role === "product" ? "Product" : "Engineering"} Assessment`;
  const repoUrl =
    input?.repoSource === "github" && input.repoUrl?.trim()
      ? input.repoUrl.trim()
      : generatedRepoUrl(titleForRepo, input?.roleTitle ?? role, level);

  if (agentProductRole) {
    return {
      title: idea?.title ?? `${prefix}One-Person Product Team Sprint`,
      repoUrl,
      brief:
        idea?.summary ??
        "Own a messy product opportunity end-to-end: synthesize user feedback, decide what not to build, orchestrate coding agents, ship a focused product surface, add an eval or telemetry check, and write the iteration memo.",
      requiredEvidence: idea?.deliverables ?? [
        "user feedback synthesis",
        "PLAN.md with no-build decisions",
        "agent orchestration log",
        "working product surface",
        "eval or telemetry check",
        "iteration memo"
      ],
      evalFocus: idea?.evaluationFocus ?? [
        "user discovery judgment",
        "product taste",
        "agent orchestration",
        "shipping discipline",
        "verification quality",
        "iteration judgment"
      ]
    };
  }

  if (role === "product") {
    return {
      title: idea?.title ?? `${prefix}Product Manager: AI Product Strategy Simulation`,
      repoUrl,
      brief: idea?.summary ?? "Create a product strategy workspace for an AI chatbot product. Produce a PRD-style plan, define target users, prioritize MVP scope, identify risks, design success metrics, and add an evaluation rubric for product quality.",
      requiredEvidence: idea?.deliverables ?? [
        "PLAN.md with product assumptions and sequencing",
        "User-facing product brief or dashboard",
        "Prioritized MVP scope and tradeoffs",
        "Quality/eval rubric for the proposed product",
        "Final notes with risks and next steps"
      ],
      evalFocus: idea?.evaluationFocus ?? ["problem framing", "prioritization", "metrics", "risk handling", "communication"]
    };
  }

  return {
    title: idea?.title ?? `${prefix}Product Build: ClawChat`,
    repoUrl,
    brief: idea?.summary ?? "Build a focused AI chat workspace inspired by modern assistant products. Improve the chat UX, implement conversation APIs, add deterministic assistant behavior, create evals for assistant quality, and verify the experience in browser and tests.",
    requiredEvidence: idea?.deliverables ?? [
      "PLAN.md before implementation",
      "Usable chat UI with clear starting point",
      "Conversation state and message API",
      "Assistant behavior for vague, concrete, and risk prompts",
      "At least one behavior-focused eval",
      "Final notes with verification and tradeoffs"
    ],
    evalFocus: idea?.evaluationFocus ?? ["requirements", "UI workflow", "API correctness", "eval quality", "AI collaboration", "production readiness"]
  };
}

export function generateAssessmentFromJd(input: AssessmentGenerationInput) {
  const role = normalizedAssessmentRole(input.roleTitle, input.jobDescription);
  const level = input.level || "Mid";
  const task = taskForRole(role, level, input.assessmentIdea, input.assessmentPrompt, input.durationMin, input);
  const durationMin = input.durationMin ?? (level.toLowerCase().includes("senior") ? 150 : 120);

  return {
    title: task.title,
    roleTitle: input.roleTitle,
    level,
    durationMin,
    repoUrl: task.repoUrl,
    instructions: [
      task.brief,
      "",
      ...projectSetupInstructions(input),
      ...(input.assessmentMode === "live_guided"
        ? [
            "Live guided session:",
            "- A company engineer may join the assessment to ask clarifying questions, request tradeoff explanations, and give light guidance.",
            "- Treat the interviewer like a teammate: explain your plan, ask clarifying questions, and narrate meaningful decisions.",
            "- Interviewer hints are allowed, but the final score considers whether you understood and acted on them thoughtfully.",
            "- The transcript is captured and scored alongside commits, tests, OpenCode logs, and final notes.",
            ""
          ]
        : []),
      "Anti one-shot policy:",
      "- Do not paste the full brief into the agent and accept a single generated solution.",
      "- Create PLAN.md first with assumptions, milestones, risks, and the tests/evals you intend to run.",
      "- Work in small checkpoints. Make at least three meaningful commits: plan/baseline, implementation, verification/evals.",
      "- The platform captures commit history, PLAN.md, OpenCode logs, diffs, visible tests, and hidden evals.",
      "- A giant one-shot diff without plan, commits, tests, or final reasoning is scored poorly even if the UI looks plausible.",
      "",
      "Candidate workflow:",
      "1. Read the product brief and create PLAN.md before coding.",
      "2. Build the smallest convincing product slice.",
      "3. Run tests and add/improve at least one eval.",
      "4. Commit meaningful checkpoints; each commit is evaluation-worthy.",
      "5. Submit final notes covering verification, tradeoffs, and next steps."
    ].join("\n"),
    taskBrief: task.brief,
    evaluationPlan: {
      role,
      repository: {
        source: input.repoSource === "github" && input.repoUrl?.trim() ? "github" : "generated",
        repoUrl: task.repoUrl,
        projectBrief: input.projectBrief?.trim() || undefined,
        existingProjectBrief: input.existingProjectBrief?.trim() || undefined,
        generatedCodebase:
          input.repoSource === "github" && input.repoUrl?.trim()
            ? false
            : true,
        package:
          input.repoSource === "github" && input.repoUrl?.trim()
            ? "Employer-linked repository with Proofwork assessment context layered in."
            : "Proofwork-generated starter repository with README.md, EVALS.md, PROOFWORK_CONTEXT.md, sample data, visible tests, and hidden eval hooks.",
        preflightRequired: true
      },
      assessmentMode: input.assessmentMode ?? "solo",
      focus: task.evalFocus,
      requiredEvidence: task.requiredEvidence,
      liveInterview:
        input.assessmentMode === "live_guided"
          ? {
              enabled: true,
              transcriptRequired: true,
              interviewerRole: "Company engineer",
              scoringSignals: [
                "clarifying questions",
                "technical explanation",
                "response to hints",
                "tradeoff discussion",
                "verification narration"
              ],
              guidancePolicy:
                "Interviewer may ask questions and offer light guidance. Heavy implementation help should be logged and considered during review."
            }
          : { enabled: false },
      commitPolicy: "Every commit should trigger a checkpoint eval; final submit uses the latest commit.",
      antiOneShotPolicy: {
        planRequired: true,
        minimumMeaningfulCommits: 3,
        giantDiffPenalty: "Submissions with one large unverified diff receive lower debugging, AI collaboration, and production readiness scores.",
        reviewSignals: ["PLAN.md", "commit history", "OpenCode log", "test output", "hidden eval output", "final notes"]
      },
      recommendationThresholds: {
        hire: 78,
        leanHire: 68,
        noHire: 60
      }
    },
    proctoringConfig: {
      enabled: Boolean(input.proctoringEnabled),
      cameraRequired: Boolean(input.proctoringEnabled),
      screenShareRequired: Boolean(input.proctoringEnabled),
      recordVideo: Boolean(input.proctoringEnabled),
      recordScreen: Boolean(input.proctoringEnabled),
      events: ["face_missing", "screen_share_stopped", "tab_blur", "copy_paste_large", "network_disconnect"]
    },
    rubric: defaultRubric,
    generatedFromJd: input.jobDescription
  };
}
