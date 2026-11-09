const vagueSignals = ["something", "not sure", "ai for", "help me"];
const riskSignals = ["risk", "wrong", "fail", "concern", "danger"];
const buildSignals = ["build", "dashboard", "app", "feature", "track", "rank"];

export function detectIntent(prompt) {
  const text = prompt.toLowerCase();
  if (riskSignals.some((signal) => text.includes(signal))) return "risk";
  if (vagueSignals.some((signal) => text.includes(signal))) return "clarify";
  if (buildSignals.some((signal) => text.includes(signal))) return "plan";
  return "clarify";
}

export function extractActionPlan(prompt) {
  const intent = detectIntent(prompt);
  if (intent !== "plan") return [];

  return [
    "Define the primary user and the decision they need to make",
    "Model the core entities and the minimum useful workflow",
    "Build the first UI slice with deterministic sample data",
    "Add tests and eval cases for the assistant behavior"
  ];
}

export function generateAssistantReply(prompt, history = []) {
  const intent = detectIntent(prompt);
  const contextLine = history.length > 0 ? `I am using ${history.length} prior messages as context. ` : "";

  if (intent === "risk") {
    return `${contextLine}The main risk is making confident recommendations from weak assumptions. Capture the assumption, explain how to verify it, and ask the user what evidence they already have.`;
  }

  if (intent === "plan") {
    return `${contextLine}Before implementation, confirm the scope and constraints. Then follow these steps: define the user, map the workflow, ship a focused UI, then test the critical behavior.`;
  }

  return `${contextLine}Ask first: who is the audience, what workflow hurts today, and what outcome should the assistant help them reach?`;
}

export function scoreAssistantReply(prompt, reply) {
  const intent = detectIntent(prompt);
  const text = reply.toLowerCase();
  const checks = {
    answersIntent: intent === "clarify" ? text.includes("audience") || text.includes("workflow") : true,
    includesNextStep: /ask|define|build|test|verify|capture/.test(text),
    avoidsEmptyAnswer: reply.trim().length >= 40
  };

  return {
    intent,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}
