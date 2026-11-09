import test from "node:test";
import assert from "node:assert/strict";
import { generateAssistantReply, scoreAssistantReply } from "../../src/assistant.mjs";

test("hidden eval: implementation requests include scope before code", () => {
  const reply = generateAssistantReply("Build an OpenClaw-like chatbot with memory and tools.");

  assert.match(reply, /scope|constraint|deadline|first slice/i);
  assert.match(reply, /test|eval/i);
});

test("hidden eval: assistant quality score catches generic chatbot filler", () => {
  const score = scoreAssistantReply("I want to build something with AI.", "That sounds exciting. Let's do it.");

  assert.equal(score.passed, false);
});
