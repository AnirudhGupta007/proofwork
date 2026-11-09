import http from "node:http";
import { generateAssistantReply } from "./assistant.mjs";
import { runAssistantEval } from "./evals.mjs";
import * as sampleData from "./sample-data.mjs";
import { createConversationStore } from "./store.mjs";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const store = createConversationStore();
const productBrief = sampleData.productBrief ?? {
  name: "Assessment starter",
  tagline: "Starter workspace",
  problem: "Implement the assessment described in README.md and TASK.md.",
  requiredCapabilities: []
};
const supportSnippets = sampleData.supportSnippets ?? [];
const usageSignals = sampleData.usageSignals ?? [];
const requiredCapabilities = Array.isArray(productBrief.requiredCapabilities) ? productBrief.requiredCapabilities : [];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function renderMessage(message) {
  return `
    <article class="message ${message.role}">
      <strong>${escapeHtml(message.role)}</strong>
      <p>${escapeHtml(message.content)}</p>
    </article>`;
}

function renderSupportSnippet(snippet) {
  return `
    <li>
      <strong>${escapeHtml(snippet.source ?? "Feedback")}</strong>
      <span>${escapeHtml(snippet.text ?? snippet)}</span>
    </li>`;
}

function renderUsageSignal(signal) {
  return `
    <li>
      <strong>${escapeHtml(signal.value ?? "")}</strong>
      <span>${escapeHtml(signal.label ?? signal)}</span>
    </li>`;
}

function render() {
  const conversation = store.listConversations()[0] ?? {
    id: "conv-empty",
    title: "Assessment starter",
    messages: []
  };
  const evalReport = runAssistantEval();

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${escapeHtml(productBrief.name)}</title>
        <style>
          :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          body { margin: 0; background: #f7f8fb; color: #172033; }
          main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 40px; }
          header { margin-bottom: 18px; }
          h1 { margin: 0 0 6px; font-size: 32px; }
          h2 { margin: 0 0 10px; font-size: 18px; }
          p { margin: 0; color: #667085; line-height: 1.5; }
          .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; align-items: start; }
          .panel, .chat { border: 1px solid #d7dde7; border-radius: 8px; background: #fff; }
          .chat { min-height: 620px; display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
          .chat-header, .composer { padding: 16px; border-bottom: 1px solid #d7dde7; }
          .composer { border-top: 1px solid #d7dde7; border-bottom: 0; display: flex; gap: 10px; }
          .composer input { flex: 1; padding: 12px; border: 1px solid #d7dde7; border-radius: 8px; }
          .composer button { padding: 0 16px; border: 0; border-radius: 8px; background: #0f766e; color: #fff; font-weight: 800; }
          .messages { display: grid; gap: 12px; align-content: start; padding: 16px; }
          .message { max-width: 78%; padding: 12px 14px; border-radius: 8px; background: #f1f5f9; }
          .message.user { justify-self: end; background: #dcfce7; }
          .message.assistant { justify-self: start; background: #eef2ff; }
          .panel { padding: 16px; display: grid; gap: 14px; }
          .feedback-list, .signal-list { display: grid; gap: 10px; padding-left: 0; list-style: none; }
          .feedback-list li, .signal-list li { display: grid; gap: 4px; padding: 10px 0; border-top: 1px solid #e5e7eb; }
          .feedback-list span, .signal-list span { color: #667085; line-height: 1.4; }
          .signal-list strong { font-size: 22px; }
          .metric { padding: 12px; border-radius: 8px; background: #ecfdf5; color: #047857; font-weight: 900; }
          code { display: block; overflow: auto; padding: 12px; border-radius: 8px; background: #111827; color: #e5edf7; font-size: 12px; }
          @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <main>
          <header>
            <h1>${escapeHtml(productBrief.name)}</h1>
            <p>${escapeHtml(productBrief.tagline)}</p>
          </header>
          <section class="layout">
            <div class="chat">
              <div class="chat-header">
                <h2>${escapeHtml(conversation.title)}</h2>
                <p>Improve this starter into the product or work artifact described in README.md. The current UI is only a starting point.</p>
              </div>
              <div class="messages">${conversation.messages.map(renderMessage).join("")}</div>
              <form class="composer">
                <input placeholder="Ask the assistant..." />
                <button type="button">Send</button>
              </form>
            </div>
            <aside class="panel">
              <div>
                <h2>Product brief</h2>
                <p>${escapeHtml(productBrief.problem)}</p>
              </div>
              ${
                supportSnippets.length
                  ? `<div>
                      <h2>Feedback snippets</h2>
                      <ul class="feedback-list">${supportSnippets.map(renderSupportSnippet).join("")}</ul>
                    </div>`
                  : ""
              }
              ${
                usageSignals.length
                  ? `<div>
                      <h2>Usage signals</h2>
                      <ul class="signal-list">${usageSignals.map(renderUsageSignal).join("")}</ul>
                    </div>`
                  : ""
              }
              <div>
                <h2>Required capabilities</h2>
                <ul>${requiredCapabilities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
              <div class="metric">${Math.round(evalReport.passRate * 100)}% eval pass rate</div>
              <code>${escapeHtml(JSON.stringify(evalReport.results, null, 2))}</code>
            </aside>
          </section>
        </main>
      </body>
    </html>`;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/health") return json(response, 200, { ok: true });
    if (request.url === "/api/conversations") return json(response, 200, { conversations: store.listConversations() });
    if (request.url === "/api/eval") return json(response, 200, runAssistantEval());

    if (request.url?.startsWith("/api/conversations/") && request.url.endsWith("/messages") && request.method === "POST") {
      const conversationId = decodeURIComponent(request.url.split("/")[3]);
      const body = await readJson(request);
      const userMessage = store.addMessage(conversationId, "user", body.content);
      const conversation = store.getConversation(conversationId);
      const reply = generateAssistantReply(body.content, conversation.messages);
      const assistantMessage = store.addMessage(conversationId, "assistant", reply);
      return json(response, 201, { userMessage, assistantMessage });
    }

    const html = render();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  } catch (err) {
    console.error(err);
    if (!response.headersSent) {
      return json(response, 400, { error: err instanceof Error ? err.message : "Request failed" });
    }
    response.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`${productBrief.name} running at http://${host}:${port}`);
});
