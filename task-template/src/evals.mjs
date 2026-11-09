import { evalCases } from "./sample-data.mjs";
import { detectIntent, generateAssistantReply, scoreAssistantReply } from "./assistant.mjs";

export function runAssistantEval(cases = evalCases) {
  const results = cases.map((item) => {
    const reply = generateAssistantReply(item.prompt);
    const score = scoreAssistantReply(item.prompt, reply);
    const lowerReply = reply.toLowerCase();
    const mentions = item.expected.mustMention.every((word) => lowerReply.includes(word));
    const intentMatches = detectIntent(item.prompt) === item.expected.intent;

    return {
      id: item.id,
      expectedIntent: item.expected.intent,
      actualIntent: score.intent,
      reply,
      passed: score.passed && mentions && intentMatches
    };
  });

  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    results
  };
}
