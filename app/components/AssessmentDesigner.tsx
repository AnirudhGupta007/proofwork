"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, FileText, FileUp, Github, Lightbulb, LockKeyhole, ShieldCheck, Wand2 } from "lucide-react";
import { RubricWeightsFields } from "@/app/components/RubricWeightsEditor";
import { DEFAULT_RUBRIC_WEIGHTS, rubricWeightsForStorage, rubricWeightsTotal, type RubricWeights } from "@/app/lib/domain/rubric";

type DesignerStep = "jd" | "repo" | "assessment" | "invite";

type Template = {
  id?: string;
  title: string;
  roleTitle?: string | null;
  level: string;
  durationMin: number;
  repoUrl?: string | null;
  taskBrief?: string | null;
  evaluationPlan?: unknown;
  proctoringConfig?: unknown;
};

type AssessmentIdea = {
  id: string;
  savedIdeaId?: string;
  title: string;
  summary: string;
  durationMin: number;
  evaluationFocus: string[];
  deliverables: string[];
  source?: string;
  repoSource?: string;
  repoUrl?: string | null;
  createdAt?: string;
};

const durationOptions = [75, 90, 120, 150] as const;
const saveStages = [
  {
    title: "Preparing assessment",
    detail: "Turning the selected idea into candidate instructions, task files, and evaluator focus."
  },
  {
    title: "Running preflight",
    detail: "Checking that the generated task package is structurally valid before it can be sent."
  },
  {
    title: "Saving reusable template",
    detail: "Making this assessment available for future candidate invites."
  },
  {
    title: "Starting review workspace",
    detail: "Provisioning a Daytona review workspace so you can inspect the generated project."
  }
];

function normalizedInitialDuration(durationMin?: number | null) {
  return durationOptions.includes(durationMin as (typeof durationOptions)[number]) ? Number(durationMin) : 120;
}

function closestDurationPreset(durationMin: number) {
  return durationOptions.reduce((closest, option) =>
    Math.abs(option - durationMin) < Math.abs(closest - durationMin) ? option : closest
  );
}

function inferAssessmentLevel(roleTitle: string, jobDescription: string) {
  const combined = `${roleTitle} ${jobDescription}`.toLowerCase();
  if (/product\s*manager|\bpm\b|product lead|product strategy/.test(combined)) return "Product Manager";
  if (/principal|staff|lead|senior|founding|head of|architect|sde\s*3|sde3|l4|l5/.test(combined)) return "Senior";
  if (/junior|graduate|entry[-\s]?level|sde\s*1|sde1|intern|associate/.test(combined)) return "Junior";
  return "Mid";
}

function ideaProjectMode(idea: AssessmentIdea) {
  const summary = idea.summary.toLowerCase();
  const mode = idea.repoSource ?? (summary.includes("existing repo") || summary.includes("existing codebase") || summary.includes("linked repo") ? "github" : "generated");
  return mode === "github"
    ? { label: "Existing repo", detail: idea.repoUrl ?? "GitHub/codebase task" }
    : { label: "New project", detail: "Generated starter repo" };
}

export function AssessmentDesigner({ initialTemplate, initialIdeas = [] }: { initialTemplate: Template; initialIdeas?: AssessmentIdea[] }) {
  const router = useRouter();
  const [roleTitle, setRoleTitle] = useState(initialTemplate.roleTitle ?? "Software Development Engineer");
  const [durationMin, setDurationMin] = useState(normalizedInitialDuration(initialTemplate.durationMin));
  const [durationSaving, setDurationSaving] = useState(false);
  const [durationSaveError, setDurationSaveError] = useState<string | null>(null);
  const [assessmentMode, setAssessmentMode] = useState<"solo" | "live_guided">("solo");
  const [repoSource, setRepoSource] = useState<"generated" | "github">(
    initialTemplate.repoUrl?.startsWith("https://github.com/") ? "github" : "generated"
  );
  const [repoUrl, setRepoUrl] = useState(
    initialTemplate.repoUrl?.startsWith("https://github.com/") ? initialTemplate.repoUrl : ""
  );
  const [projectBrief, setProjectBrief] = useState(
    "Build a focused product surface from a rough employer idea. Proofwork should expand this into a runnable starter repo with realistic data, task files, tests, and eval expectations."
  );
  const [existingProjectBrief, setExistingProjectBrief] = useState(
    "Ask the candidate to understand the existing codebase, ship one focused improvement, add or improve tests/evals, and explain tradeoffs in the current repo style."
  );
  const [jobDescription, setJobDescription] = useState(
    "Product engineer who can build an AI product workflow, use coding agents responsibly, design tests/evals, and explain product and engineering tradeoffs."
  );
  const [assessmentPrompt, setAssessmentPrompt] = useState(
    "Test user discovery judgment, product taste, multi-agent orchestration, fast shipping, verification/evals, what-not-to-build decisions, and iteration from real feedback. Penalize one-shot submissions."
  );
  const [template, setTemplate] = useState(initialTemplate);
  const [ideas, setIdeas] = useState<AssessmentIdea[]>(initialIdeas);
  const [selectedIdea, setSelectedIdea] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveStepIndex, setSaveStepIndex] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [githubSetupUrl, setGithubSetupUrl] = useState<string | null>(null);
  const [githubSetupSteps, setGithubSetupSteps] = useState<string[]>([]);
  const [step, setStep] = useState<DesignerStep>("jd");
  const [scoringWeights, setScoringWeights] = useState<RubricWeights>({ ...DEFAULT_RUBRIC_WEIGHTS });
  const scoringWeightsTotal = rubricWeightsTotal(scoringWeights);
  const scoringWeightsValid = scoringWeightsTotal === 100;
  const projectModeSummary =
    repoSource === "generated"
      ? `New project brief: ${projectBrief.trim()}`
      : `Existing project repo: ${repoUrl.trim() || "GitHub repo not entered yet"}\nCandidate work in repo: ${existingProjectBrief.trim()}`;
  const inferredLevel = inferAssessmentLevel(roleTitle, jobDescription);

  useEffect(() => {
    if (!busy) {
      setSaveStepIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setSaveStepIndex((current) => Math.min(current + 1, saveStages.length - 1));
    }, 4500);

    return () => window.clearInterval(interval);
  }, [busy]);

  async function chooseDuration(option: number) {
    setDurationMin(option);
    if (!template?.id) return;
    if (option === template.durationMin) return;

    setDurationSaving(true);
    setDurationSaveError(null);
    try {
      const response = await fetch("/api/admin/assessment-template", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, durationMin: option })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save assessment length.");
      }
      if (payload.template) {
        setTemplate(payload.template);
      }
      router.refresh();
    } catch (err) {
      setDurationSaveError(err instanceof Error ? err.message : "Unable to save assessment length.");
    } finally {
      setDurationSaving(false);
    }
  }

  async function generate() {
    if (!scoringWeightsValid) {
      setMessage(`Scoring rubric weights must add up to 100% (currently ${scoringWeightsTotal}%).`);
      return;
    }
    setBusy(true);
    setSaveStepIndex(0);
    setMessage(null);
    const selectedDetails = ideas.find((idea) => (idea.savedIdeaId ?? idea.id) === selectedIdea);
    const response = await fetch("/api/admin/assessment-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleTitle,
        level: inferredLevel,
        durationMin,
        jobDescription,
        repoSource,
        repoUrl,
        projectBrief,
        existingProjectBrief,
        assessmentIdea: selectedDetails?.id ?? selectedIdea ?? undefined,
        assessmentIdeaDetails: selectedDetails,
        assessmentPrompt,
        assessmentMode,
        scoringWeights: rubricWeightsForStorage(scoringWeights)
      })
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to generate assessment.");
      return;
    }

    setTemplate(payload.template);
    setMessage("Assessment generated and saved. New invites will use this task.");
    setStep("invite");
    router.refresh();
  }

  async function uploadJd(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    setMessage(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("roleTitle", roleTitle);
    formData.set("level", inferredLevel);

    const response = await fetch("/api/admin/jd-upload", {
      method: "POST",
      body: formData
    });
    const payload = await response.json();
    setUploadBusy(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to upload JD.");
      return;
    }

    setJobDescription(payload.text);
    setIdeas(payload.ideas ?? []);
    setSelectedIdea(payload.ideas?.[0] ? (payload.ideas[0].savedIdeaId ?? payload.ideas[0].id) : null);
    setStep("repo");
    setMessage(`Extracted JD from ${payload.fileName}. Next, choose whether candidates work on a generated project or an existing repo.`);
  }

  async function generateIdeas() {
    setIdeasBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/assessment-ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleTitle,
        level: inferredLevel,
        durationMin,
        jobDescription,
        repoSource,
        repoUrl,
        projectBrief,
        existingProjectBrief,
        assessmentPrompt,
        assessmentMode
      })
    });
    const payload = await response.json();
    setIdeasBusy(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to generate assessment ideas.");
      return;
    }

    setIdeas(payload.ideas ?? []);
    setSelectedIdea(payload.ideas?.[0] ? (payload.ideas[0].savedIdeaId ?? payload.ideas[0].id) : null);
    setStep("assessment");
    setMessage(
      payload.source === "llm"
        ? "Custom AI-generated assessment ideas were saved. Choose one, then save it for new invites."
        : `Reusable fallback assessment ideas were saved. ${payload.reason ?? "Add an OpenAI key/model for fully bespoke ideas."}`
    );
  }

  async function draftJd() {
    setDraftBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/jd-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleTitle, level: inferredLevel })
    });
    const payload = await response.json();
    setDraftBusy(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to draft JD.");
      return;
    }

    setJobDescription(payload.text);
    setIdeas([]);
    setSelectedIdea(null);
    setMessage(payload.source === "llm" ? "Drafted a JD from the role title." : "Drafted a fallback JD from the role title.");
  }

  async function applyAssessmentPrompt() {
    await generateIdeas();
  }

  async function connectGitHub() {
    setGithubMessage(null);
    setGithubSetupUrl(null);
    setGithubSetupSteps([]);
    const response = await fetch("/api/admin/github/connect");
    const payload = await response.json();
    if (!response.ok) {
      setGithubMessage(payload.error ?? "GitHub private repo access is not configured yet.");
      setGithubSetupUrl(payload.setupUrl ?? null);
      setGithubSetupSteps(Array.isArray(payload.setupSteps) ? payload.setupSteps : []);
      return;
    }
    window.location.href = payload.url;
  }

  const evalPlan =
    template.evaluationPlan && typeof template.evaluationPlan === "object"
      ? (template.evaluationPlan as {
          focus?: string[];
          reviewWorkspace?: {
            status?: string;
            appPreviewUrl?: string;
            terminalUrl?: string;
            error?: string;
            readyAt?: string;
            expiresAt?: string;
          };
        })
      : null;
  const repositoryPlan =
    template.evaluationPlan && typeof template.evaluationPlan === "object"
      ? ((template.evaluationPlan as { repository?: { source?: string; repoUrl?: string; package?: string } }).repository ?? null)
      : null;
  const selectedIdeaDetails = ideas.find((idea) => (idea.savedIdeaId ?? idea.id) === selectedIdea);

  return (
    <section className="card grid">
      <div>
        <p className="eyebrow">Assessment designer</p>
        <h2>Build an assessment from a JD</h2>
        <p className="muted">
          Upload or paste the JD, review assessment ideas, then save the best one as the task used for new candidate invites.
        </p>
      </div>

      <div className="flow-stepper" aria-label="Assessment setup steps">
        <button className={step === "jd" ? "active" : ""} type="button" onClick={() => setStep("jd")}>
          <span>1</span>
          <strong>Start with JD</strong>
          <small>Draft, paste, or upload</small>
        </button>
        <button className={step === "repo" ? "active" : ""} type="button" onClick={() => setStep("repo")}>
          <span>2</span>
          <strong>Choose codebase</strong>
          <small>New project or repo</small>
        </button>
        <button className={step === "assessment" ? "active" : ""} type="button" onClick={() => setStep("assessment")}>
          <span>3</span>
          <strong>Refine what to test</strong>
          <small>Ideas and eval focus</small>
        </button>
        <button className={step === "invite" ? "active" : ""} type="button" onClick={() => setStep("invite")}>
          <span>4</span>
          <strong>Save and invite</strong>
          <small>Active task snapshot</small>
        </button>
      </div>

      {step === "jd" ? (
        <div className="flow-panel">
      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="roleTitle">Position / hiring role</label>
          <input id="roleTitle" className="input" value={roleTitle} onChange={(event) => setRoleTitle(event.target.value)} />
        </div>
        <div className="field">
          <label>Assessment length</label>
          <div className="duration-options" role="radiogroup" aria-label="Assessment length">
            {durationOptions.map((option) => (
              <button
                className={durationMin === option ? "duration-option active" : "duration-option"}
                key={option}
                type="button"
                onClick={() => chooseDuration(option)}
                disabled={durationSaving}
              >
                {option} min
              </button>
            ))}
          </div>
          <p className="muted">
            120 minutes is the default. Use 150 minutes only for deeper senior work samples.
            {durationSaving ? " Saving…" : null}
          </p>
          {durationSaveError ? <p className="muted error">{durationSaveError}</p> : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="assessmentMode">Assessment type</label>
        <select
          id="assessmentMode"
          className="input"
          value={assessmentMode}
          onChange={(event) => setAssessmentMode(event.target.value as "solo" | "live_guided")}
        >
          <option value="solo">Async solo work simulation</option>
          <option value="live_guided">Live guided session with company engineer</option>
        </select>
        <p className="muted">
          Live guided sessions log interviewer questions, hints, and candidate responses, then score communication alongside the work.
        </p>
      </div>

      <div className="assessment-chat-panel">
        <div>
          <p className="eyebrow">Assessment copilot</p>
          <h3>Start from the position, then make the JD concrete</h3>
          <p className="muted">Proofwork infers seniority from the title and JD, so the employer only has to describe the actual role and work.</p>
          {draftBusy ? (
            <div className="inline-progress" role="status" aria-live="polite">
              <div>
                <strong>Drafting the JD</strong>
                <span>Reading the position, inferring the hiring bar, and shaping responsibilities.</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span />
              </div>
            </div>
          ) : null}
        </div>
        <div className="assessment-chat-actions">
          <button className="button secondary" type="button" onClick={draftJd} disabled={draftBusy || roleTitle.trim().length < 2}>
            {draftBusy ? <span className="button-spinner" aria-hidden="true" /> : <Wand2 size={16} />}
            {draftBusy ? "Drafting JD" : "Draft JD from role"}
          </button>
        </div>
      </div>

      <div className="jd-upload-zone">
        <FileUp size={22} />
        <div>
          <strong>Upload JD</strong>
          <span>PDF, DOCX, TXT, or Markdown. We extract the text before creating assessment ideas.</span>
        </div>
        <label className="button secondary" htmlFor="jdFile">
          {uploadBusy ? "Reading file" : "Choose file"}
        </label>
        <input
          id="jdFile"
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          hidden
          disabled={uploadBusy}
          onChange={(event) => {
            void uploadJd(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="field">
        <label htmlFor="jd">JD / hiring brief</label>
        <textarea id="jd" className="textarea tall" value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} />
      </div>
      <div className="flow-actions">
        <button className="button" type="button" onClick={() => setStep("repo")} disabled={jobDescription.trim().length < 30}>
          Continue
        </button>
      </div>
      </div>
      ) : null}

      {step === "repo" ? (
        <div className="flow-panel">
      <div className="repo-source-panel">
        <div>
          <p className="eyebrow">Project mode</p>
          <h3>What should candidates work on?</h3>
          <p className="muted">
            Start from a new product idea, or use an existing codebase when you want candidates to work inside a real repo.
          </p>
        </div>
        <div className="repo-source-options" role="radiogroup" aria-label="Task repo source">
          <label className={repoSource === "generated" ? "repo-source-option selected" : "repo-source-option"}>
            <input
              type="radio"
              name="repoSource"
              checked={repoSource === "generated"}
              onChange={() => setRepoSource("generated")}
            />
            <strong>New project from brief</strong>
            <span>Describe the product or workflow. Proofwork turns it into a runnable starter repo, sample data, task files, tests, and eval hooks.</span>
          </label>
          <label className={repoSource === "github" ? "repo-source-option selected" : "repo-source-option"}>
            <input
              type="radio"
              name="repoSource"
              checked={repoSource === "github"}
              onChange={() => setRepoSource("github")}
            />
            <strong>Existing project / GitHub repo</strong>
            <span>Candidate devbox clones your repo. Proofwork layers candidate instructions, eval expectations, and evidence capture on top.</span>
          </label>
        </div>
        <div className="repo-primary-action">
          <div>
            <strong>Create assessment ideas from the JD</strong>
            <span>
              Proofwork will use the hiring brief, duration, and selected project mode to draft reusable assessment templates.
            </span>
            {ideasBusy ? (
              <div className="inline-progress" role="status" aria-live="polite">
                <div>
                  <strong>Creating assessment ideas</strong>
                  <span>Reading the JD, project mode, duration, and evaluation focus to create reusable task options.</span>
                </div>
                <div className="progress-track" aria-hidden="true">
                  <span />
                </div>
              </div>
            ) : null}
          </div>
          <button className="button secondary" type="button" onClick={generateIdeas} disabled={ideasBusy || jobDescription.length < 30}>
            {ideasBusy ? <span className="button-spinner" aria-hidden="true" /> : <Lightbulb size={16} />}
            {ideasBusy ? "Creating ideas" : "Create assessment ideas"}
          </button>
        </div>
        {repoSource === "github" ? (
          <div className="grid">
            <div className="field">
              <label htmlFor="repoUrl">GitHub repository URL</label>
              <input
                id="repoUrl"
                className="input"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/company/product-repo.git"
              />
              <p className="muted">
                Public repos can be cloned directly. Private repos should be connected through a GitHub App so you can grant access to selected repos only.
              </p>
            </div>
            <div className="github-connect-panel">
              <Github size={20} />
              <div>
                <strong>Private repo access</strong>
                <span>
                  Connect GitHub, install the Proofwork app on specific private repos, then each candidate gets a fresh Daytona clone for their attempt.
                </span>
                {githubMessage ? <p className="error-text">{githubMessage}</p> : null}
                {githubSetupSteps.length > 0 ? (
                  <div className="github-setup-steps">
                    <strong>One-time setup for private repos</strong>
                    <ol>
                      {githubSetupSteps.map((setupStep) => (
                        <li key={setupStep}>{setupStep}</li>
                      ))}
                    </ol>
                    {githubSetupUrl ? (
                      <a className="button secondary" href={githubSetupUrl} target="_blank" rel="noreferrer">
                        Create GitHub App
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <button className="button secondary" type="button" onClick={connectGitHub}>
                <LockKeyhole size={16} />
                Connect GitHub
              </button>
            </div>
            <div className="field">
              <label htmlFor="existingProjectBrief">What should the candidate change in this repo?</label>
              <textarea
                id="existingProjectBrief"
                className="textarea compact"
                value={existingProjectBrief}
                onChange={(event) => setExistingProjectBrief(event.target.value)}
                placeholder="Example: improve the onboarding flow, add one product eval, fix flaky behavior, and write a short launch note."
              />
            </div>
          </div>
        ) : (
          <div className="grid">
            <div className="field">
              <label htmlFor="projectBrief">New project brief</label>
              <textarea
                id="projectBrief"
                className="textarea compact"
                value={projectBrief}
                onChange={(event) => setProjectBrief(event.target.value)}
                placeholder="Example: Build a lightweight feedback triage panel for hiring managers reviewing candidate reports."
              />
              <p className="muted">
                This can be rough. Proofwork will detail the candidate task, repo context, sample data, visible tests, and hidden eval focus.
              </p>
            </div>
            <div className="notice-panel">
              <strong>Generated repo package</strong>
              <span>
                Saving the assessment creates a generated repo reference. Daytona provisions it as a real git repo in the candidate workspace and runs
                the preflight before invites use it.
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="flow-actions">
        <button className="button" type="button" onClick={() => setStep("assessment")}>
          Continue to assessment ideas
        </button>
      </div>
      </div>
      ) : null}

      {step === "assessment" ? (
        <div className="flow-panel">
      <div className="field">
        <label htmlFor="assessmentPrompt">What should this assessment test?</label>
        <textarea
          id="assessmentPrompt"
          className="textarea compact"
          value={assessmentPrompt}
          onChange={(event) => setAssessmentPrompt(event.target.value)}
          placeholder="Example: test product thinking, ability to iterate with AI, eval design, debugging discipline, and clean communication."
        />
        <p className="muted">{projectModeSummary}</p>
      </div>

      <div className="repo-primary-action">
        <div>
          <strong>Refresh assessment ideas</strong>
          <span>Update the generated ideas after changing the evaluation focus.</span>
          {ideasBusy ? (
            <div className="inline-progress" role="status" aria-live="polite">
              <div>
                <strong>Refreshing assessment ideas</strong>
                <span>Applying your latest scoring focus and project context.</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span />
              </div>
            </div>
          ) : null}
        </div>
        <button className="button secondary" type="button" onClick={generateIdeas} disabled={ideasBusy || jobDescription.length < 30}>
          {ideasBusy ? <span className="button-spinner" aria-hidden="true" /> : <Lightbulb size={16} />}
          {ideasBusy ? "Creating ideas" : "Create assessment ideas"}
        </button>
      </div>

      {ideas.length > 0 ? (
        <>
        <div>
          <p className="eyebrow">{initialIdeas.length > 0 ? "Saved assessment ideas" : "Assessment ideas"}</p>
          <p className="muted">Each card is labeled as a new generated project or an existing repo task. Select one and save it to use it for future invites.</p>
        </div>
        <div className="assessment-ideas" aria-label="Assessment ideas">
          {ideas.map((idea) => {
            const ideaSelectionKey = idea.savedIdeaId ?? idea.id;
            const mode = ideaProjectMode(idea);
            return (
              <button
                className={selectedIdea === ideaSelectionKey ? "assessment-idea selected" : "assessment-idea"}
                key={ideaSelectionKey}
                type="button"
                onClick={() => {
                  setSelectedIdea(ideaSelectionKey);
                  setMessage(`Selected "${idea.title}". Save it to use this task for new invites and devboxes.`);
                }}
              >
                <div>
                  <Lightbulb size={18} />
                  {selectedIdea === ideaSelectionKey ? <CheckCircle2 size={18} /> : null}
                </div>
                <p className="idea-mode">
                  <strong>{mode.label}</strong>
                  <span>{mode.detail}</span>
                </p>
                <strong>{idea.title}</strong>
                <span>{idea.summary}</span>
                <small>Focus: {idea.evaluationFocus.join(", ")}</small>
                {idea.createdAt ? <small>Saved {new Date(idea.createdAt).toLocaleDateString()}</small> : null}
              </button>
            );
          })}
        </div>
        </>
      ) : null}

      <div className="field rubric-section">
        <label htmlFor="rubric-new-requirements">Scoring rubric</label>
        <p className="muted">
          Decide how much each criterion counts toward the overall 0-100 score. Weights must add up to 100%.
        </p>
        <RubricWeightsFields weights={scoringWeights} onChange={setScoringWeights} disabled={busy} idPrefix="rubric-new" />
      </div>

      {busy ? (
        <div className="save-progress-panel" role="status" aria-live="polite">
          <div>
            <strong>{saveStages[saveStepIndex].title}</strong>
            <span>{saveStages[saveStepIndex].detail}</span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span />
          </div>
          <ol>
            {saveStages.map((stage, index) => (
              <li className={index <= saveStepIndex ? "active" : ""} key={stage.title}>
                {stage.title}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <button className="button" type="button" onClick={generate} disabled={busy || !scoringWeightsValid}>
        {busy ? <span className="button-spinner" aria-hidden="true" /> : <Wand2 size={16} />}
        {busy ? "Saving assessment" : selectedIdea ? "Save selected assessment" : "Generate and save assessment"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
      {selectedIdeaDetails ? (
        <div className="notice-panel">
          <strong>Selected draft</strong>
          <span>
            {selectedIdeaDetails.title} is selected. It becomes the candidate task, README/EVALS context, and OpenCode guidance after you save.
          </span>
        </div>
      ) : null}
      </div>
      ) : null}

      {step === "invite" ? (
        <div className="flow-panel">
      <div className="generated-assessment">
        <div>
          <Bot size={18} />
          <strong>Currently saved: {template.title}</strong>
          <span>{template.taskBrief}</span>
        </div>
        <div>
          <FileText size={18} />
          <strong>Task repo</strong>
          <span>{repositoryPlan?.source === "github" ? repositoryPlan.repoUrl : repositoryPlan?.repoUrl ?? template.repoUrl ?? "Generated repo not saved yet"}</span>
        </div>
        <div>
          <FileText size={18} />
          <strong>Evaluation focus</strong>
          <span>{evalPlan?.focus?.join(", ") ?? "Not generated yet"}</span>
        </div>
        <div>
          <ShieldCheck size={18} />
          <strong>Invite controls</strong>
          <span>Camera, screen share, and recording are configured when you send each invite.</span>
        </div>
        <div>
          <Bot size={18} />
          <strong>Review workspace</strong>
          <span>
            {evalPlan?.reviewWorkspace?.status === "ready"
              ? `Ready until ${new Date(evalPlan.reviewWorkspace.expiresAt ?? "").toLocaleString()}`
              : evalPlan?.reviewWorkspace?.status === "failed"
                ? `Failed: ${evalPlan.reviewWorkspace.error}`
                : "Not created yet"}
          </span>
        </div>
      </div>
      {evalPlan?.reviewWorkspace?.status === "ready" ? (
        <div className="button-row">
          {evalPlan.reviewWorkspace.appPreviewUrl ? (
            <a className="button" href={evalPlan.reviewWorkspace.appPreviewUrl} target="_blank" rel="noreferrer">
              Open project preview
            </a>
          ) : null}
          {evalPlan.reviewWorkspace.terminalUrl ? (
            <a className="button secondary" href={evalPlan.reviewWorkspace.terminalUrl} target="_blank" rel="noreferrer">
              Open review terminal
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="notice-panel">
        <strong>Ready for applicants</strong>
        <span>The invite form below will use this saved assessment version. If you change the assessment later, previously sent invites keep their original task.</span>
      </div>
      </div>
      ) : null}
      {step !== "assessment" && message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
