import { env } from "@/app/lib/env";

export function fallbackJdFromRole(roleTitle: string, level: string) {
  const role = roleTitle.trim() || "Software Development Engineer";
  const seniority = level.trim() || "Mid";
  const isProduct = /product|pm|manager/i.test(role);

  if (isProduct) {
    return `${role} (${seniority}) responsible for defining useful AI product experiences, turning ambiguous customer problems into crisp scope, designing launch metrics, handling stakeholder tradeoffs, and creating evaluation plans for usefulness, reliability, and risk. The role requires clear written judgment, prioritization, product taste, data-informed thinking, and the ability to make launch/no-launch recommendations without a manager supplying a perfect spec.`;
  }

  return `${role} (${seniority}) responsible for owning product surfaces end-to-end in an existing TypeScript application. The role requires direct user empathy, product taste, practical system design, responsible AI coding-agent orchestration, fast implementation, strong verification through tests/evals, and clear communication about tradeoffs, risks, and what not to build.`;
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const record = response as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;

  if (!Array.isArray(record.output)) return "";

  return record.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.map((part) => {
        if (!part || typeof part !== "object") return "";
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      });
    })
    .join("")
    .trim();
}

export async function draftJdFromRoleTitle({
  roleTitle,
  level
}: {
  roleTitle: string;
  level: string;
}) {
  const fallback = fallbackJdFromRole(roleTitle, level);
  if (!env.OPENAI_API_KEY) return { source: "fallback" as const, text: fallback };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.ASSESSMENT_GENERATOR_MODEL,
      input: [
        {
          role: "system",
          content:
            "Draft concise, assessment-ready hiring JDs for Proofwork. Avoid buzzword soup, DSA, trivia, and generic ticket-taker descriptions. Emphasize the real work, signals to test, and what would make someone not a fit."
        },
        {
          role: "user",
          content: JSON.stringify({
            roleTitle,
            level,
            desiredLength: "220-320 words",
            include: [
              "what they will actually do",
              "what signal matters",
              "AI-agent workflow expectations when relevant",
              "what not to build or not to test",
              "who is probably not a fit"
            ]
          })
        }
      ]
    })
  });

  if (!response.ok) return { source: "fallback" as const, text: fallback };

  const text = extractResponseText(await response.json());
  if (text.length < 120) return { source: "fallback" as const, text: fallback };

  return { source: "llm" as const, text };
}

