export const productBrief = {
  name: "ClawChat",
  tagline: "A focused AI chat workspace for turning vague product ideas into concrete build plans.",
  audience: "founders and product engineers exploring a new software idea",
  problem:
    "Users can ask a generic chatbot for product advice, but the output is often hard to act on. They need a chat experience that keeps context, asks useful follow-up questions, extracts action items, and shows lightweight quality checks.",
  constraints: [
    "3-hour prototype window",
    "No authentication required",
    "Use an in-memory conversation store",
    "The assistant may be deterministic or model-backed, but tests must be deterministic"
  ],
  requiredCapabilities: [
    "Chat UI with user and assistant messages",
    "Conversation state and message creation API",
    "Assistant replies that ask clarifying questions when the prompt is vague",
    "Action-plan extraction for concrete build requests",
    "A lightweight eval report for assistant quality"
  ]
};

export const conversations = [
  {
    id: "conv-product-launch",
    title: "AI launch planning assistant",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "I want to build an AI assistant for founders but I am not sure where to start.",
        createdAt: "2026-05-07T09:00:00.000Z"
      },
      {
        id: "m2",
        role: "assistant",
        content:
          "Let's narrow the audience, the painful workflow, and the first outcome. Who is the first user and what decision should the assistant help them make?",
        createdAt: "2026-05-07T09:00:10.000Z"
      }
    ]
  }
];

export const supportSnippets = [
  {
    source: "WhatsApp user note",
    text:
      "I pasted five customer complaints and the assistant gave me a generic roadmap. I needed it to tell me which one thing to fix this week."
  },
  {
    source: "Sales call note",
    text:
      "The buyer likes the AI summary, but they do not trust it unless it shows the exact feedback that led to the recommendation."
  },
  {
    source: "Support ticket",
    text:
      "The current flow jumps straight into building features. It never asks what segment, workflow, or success metric matters."
  }
];

export const usageSignals = [
  { label: "Users who abandon after first AI answer", value: "41%" },
  { label: "Sessions with copied output", value: "18%" },
  { label: "Top repeated phrase in feedback", value: "What should I do next?" }
];

export const evalCases = [
  {
    id: "vague-idea",
    prompt: "I want to build something with AI for sales.",
    expected: {
      intent: "clarify",
      mustMention: ["audience", "workflow"]
    }
  },
  {
    id: "build-request",
    prompt: "Build a dashboard where founders can rank startup ideas and track validation tasks.",
    expected: {
      intent: "plan",
      mustMention: ["steps", "test"]
    }
  },
  {
    id: "risk-request",
    prompt: "What could go wrong if the assistant gives product advice without enough context?",
    expected: {
      intent: "risk",
      mustMention: ["assumption", "verify"]
    }
  }
];
