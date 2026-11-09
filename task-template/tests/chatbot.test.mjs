import test from "node:test";
import assert from "node:assert/strict";
import { detectIntent, extractActionPlan, generateAssistantReply, scoreAssistantReply } from "../src/assistant.mjs";
import { runAssistantEval } from "../src/evals.mjs";
import { createConversationStore } from "../src/store.mjs";

test("vague prompts trigger clarifying behavior", () => {
  const prompt = "I want to build something with AI for sales.";
  const reply = generateAssistantReply(prompt);

  assert.equal(detectIntent(prompt), "clarify");
  assert.match(reply, /audience/i);
  assert.match(reply, /workflow/i);
});

test("build prompts produce a concrete action plan", () => {
  const actions = extractActionPlan("Build a dashboard where founders rank startup ideas.");

  assert.equal(actions.length >= 3, true);
  assert.equal(actions.some((action) => /test|eval/i.test(action)), true);
});

test("risk prompts mention assumptions and verification", () => {
  const prompt = "What could go wrong if the assistant gives product advice without enough context?";
  const reply = generateAssistantReply(prompt);

  assert.equal(detectIntent(prompt), "risk");
  assert.match(reply, /assumption/i);
  assert.match(reply, /verify/i);
});

test("conversation store appends user and assistant messages", () => {
  const store = createConversationStore([
    {
      id: "conv-1",
      title: "Test conversation",
      messages: []
    }
  ]);

  store.addMessage("conv-1", "user", "Build a launch planning chatbot");
  store.addMessage("conv-1", "assistant", "Here is a plan.");

  assert.equal(store.getConversation("conv-1").messages.length, 2);
});

test("assistant scoring rejects empty or unhelpful answers", () => {
  const result = scoreAssistantReply("I want to build something with AI.", "Sure.");

  assert.equal(result.passed, false);
});

test("eval report passes the starter quality cases", () => {
  const report = runAssistantEval();

  assert.equal(report.total, 3);
  assert.equal(report.passRate, 1);
});

test("assistant asks for explicit constraints before implementation", () => {
  const reply = generateAssistantReply("Build me an AI chatbot for founders.");

  assert.match(reply, /constraint|scope|deadline/i);
});
