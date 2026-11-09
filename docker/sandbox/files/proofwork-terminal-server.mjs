// Prebaked proofwork terminal server.
//
// Lives at /opt/opencode-bin/proofwork-terminal-server.mjs in the
// runtime image. Same directory as node_modules/ws so the ESM import
// resolves without symlink traversal — fast cold start (~5s vs the
// 80-130s the per-attempt .mjs script template used to pay).
//
// Configured entirely via env vars at process spawn; no per-attempt
// script generation. Attach just runs:
//   setsid env PROOFWORK_TERMINAL_PORT=... PROOFWORK_TERMINAL_COMMAND=... \
//     nohup node /opt/opencode-bin/proofwork-terminal-server.mjs \
//     >> /tmp/terminal-<attemptId>.log 2>&1 < /dev/null &

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import * as ptyMod from "node-pty";

const port = Number(process.env.PROOFWORK_TERMINAL_PORT || "7681");
const command = process.env.PROOFWORK_TERMINAL_COMMAND;
const repoDir = process.env.PROOFWORK_REPO_DIR || process.cwd();
const logPath = process.env.PROOFWORK_TERMINAL_LOG || "/tmp/proofwork-terminal.log";
const toolRoot = path.dirname(fileURLToPath(import.meta.url));

if (!command) {
  throw new Error("PROOFWORK_TERMINAL_COMMAND is required");
}

function appendLog(chunk) {
  fs.appendFile(logPath, chunk, () => {});
}

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Proofwork Terminal</title>
    <link rel="stylesheet" href="/assets/xterm.css" />
    <style>
      html, body, #terminal { width: 100%; height: 100%; margin: 0; background: #050505; }
      body { overflow: hidden; }
      #status {
        position: fixed;
        right: 12px;
        top: 10px;
        z-index: 2;
        color: #d7d7d7;
        background: rgba(0, 0, 0, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.16);
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        padding: 4px 8px;
      }
    </style>
  </head>
  <body>
    <div id="status">connecting</div>
    <div id="terminal"></div>
    <script src="/assets/xterm.js"></script>
    <script src="/assets/fit.js"></script>
    <script>
      const status = document.getElementById("status");
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        theme: { background: "#050505", foreground: "#f3f3f3", cursor: "#f3f3f3" }
      });
      const fit = new FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(document.getElementById("terminal"));
      fit.fit();
      term.focus();

      const protocol = location.protocol === "https:" ? "wss" : "ws";
      const wsUrl = protocol + "://" + location.host + "/terminal";
      let socket = null;
      let retries = 0;
      let reconnectTimer = null;

      function clearReconnect() {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }

      function sendResize() {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }

      function connect() {
        clearReconnect();
        status.textContent = retries > 0 ? "reconnecting…" : "connecting";
        socket = new WebSocket(wsUrl);

        socket.addEventListener("open", () => {
          status.textContent = "connected";
          retries = 0;
          sendResize();
        });
        socket.addEventListener("message", (event) => term.write(event.data));
        socket.addEventListener("close", () => {
          status.textContent = "disconnected";
          // Backoff: 500ms, 1s, 2s, 4s, capped at 5s.
          const delay = Math.min(5000, 500 * Math.pow(2, retries));
          retries += 1;
          reconnectTimer = setTimeout(connect, delay);
        });
        socket.addEventListener("error", () => {
          status.textContent = "connection error";
        });
      }

      connect();

      // Force an immediate reconnect when the tab becomes visible again
      // (background tabs can have their WS dropped by the browser or by
      // an upstream proxy without our heartbeat catching it in time).
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          retries = 0;
          connect();
        } else if (socket.readyState === WebSocket.OPEN) {
          sendResize();
        }
      });

      term.onData((data) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      });
      term.onResize(sendResize);
      window.addEventListener("resize", () => {
        fit.fit();
        sendResize();
      });
    </script>
  </body>
</html>`;

function sendFile(res, relativePath, contentType) {
  const absolutePath = path.join(toolRoot, relativePath);
  fs.readFile(absolutePath, (error, body) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("asset not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable"
    });
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  if (url.pathname === "/assets/xterm.css") {
    sendFile(res, "node_modules/@xterm/xterm/css/xterm.css", "text/css; charset=utf-8");
    return;
  }
  if (url.pathname === "/assets/xterm.js") {
    sendFile(res, "node_modules/@xterm/xterm/lib/xterm.js", "application/javascript; charset=utf-8");
    return;
  }
  if (url.pathname === "/assets/fit.js") {
    sendFile(res, "node_modules/@xterm/addon-fit/lib/addon-fit.js", "application/javascript; charset=utf-8");
    return;
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "x-frame-options": "ALLOWALL",
    "cache-control": "no-store"
  });
  res.end(html);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/terminal") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

// Single pty per server process (one process per attempt). We keep
// it alive across WS connections so that switching tabs, brief
// network blips, or proxy idle-timeouts don't terminate opencode.
// New WS connections attach to the existing pty and get the recent
// output replayed so the candidate's session feels continuous.
let pty = null;
let activeWs = null;
const replayBuffer = [];
let replayBytes = 0;
const REPLAY_LIMIT_BYTES = 256 * 1024;
let lastCols = 120;
let lastRows = 32;

function pushReplay(chunk) {
  replayBuffer.push(chunk);
  replayBytes += Buffer.byteLength(chunk, "utf8");
  while (replayBytes > REPLAY_LIMIT_BYTES && replayBuffer.length > 1) {
    const dropped = replayBuffer.shift();
    replayBytes -= Buffer.byteLength(dropped, "utf8");
  }
}

function ensurePty() {
  if (pty) return pty;
  pty = ptyMod.spawn("/bin/sh", ["-c", command], {
    name: "xterm-256color",
    cols: lastCols,
    rows: lastRows,
    cwd: repoDir,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" }
  });

  pty.onData((data) => {
    appendLog(data);
    pushReplay(data);
    if (activeWs && activeWs.readyState === activeWs.OPEN) {
      activeWs.send(data);
    }
  });
  pty.onExit(({ exitCode, signal }) => {
    appendLog("\n[proofwork-terminal] pty exit code=" + exitCode + " signal=" + signal + "\n");
    pty = null;
    if (activeWs && activeWs.readyState === activeWs.OPEN) {
      activeWs.send("\r\n[opencode exited]\r\n");
      activeWs.close();
    }
  });
  return pty;
}

wss.on("connection", (ws) => {
  appendLog("\n[proofwork-terminal] connection opened\n");

  // Only one viewer at a time. If a previous WS is still around
  // (slow close, second tab), close it cleanly so the new one owns
  // pty output going forward.
  if (activeWs && activeWs.readyState === activeWs.OPEN && activeWs !== ws) {
    try { activeWs.close(1000, "superseded"); } catch {}
  }
  activeWs = ws;

  ensurePty();

  // Catch the new tab up with whatever pty output we have buffered.
  // For TUIs like opencode this means the full-screen redraw arrives
  // immediately on reconnect; for shell sessions, the last ~256 KB
  // of scrollback.
  for (const chunk of replayBuffer) {
    try { ws.send(chunk); } catch {}
  }

  // Keep the WS warm through any intermediate proxy idle-timeout
  // (Daytona's edge, nginx, CF tunnel). The ws library handles
  // ping/pong frames transparently — xterm never sees them.
  let alive = true;
  ws.on("pong", () => { alive = true; });
  const heartbeat = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    if (!alive) {
      appendLog("\n[proofwork-terminal] heartbeat missed, terminating ws\n");
      try { ws.terminate(); } catch {}
      return;
    }
    alive = false;
    try { ws.ping(); } catch {}
  }, 25000);

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "input" && pty) {
        pty.write(message.data);
      }
      if (message.type === "resize") {
        const cols = Math.max(10, Number(message.cols) | 0);
        const rows = Math.max(5, Number(message.rows) | 0);
        lastCols = cols;
        lastRows = rows;
        appendLog("\n[proofwork-terminal] resize " + cols + "x" + rows + "\n");
        if (pty) {
          try {
            pty.resize(cols, rows);
          } catch (error) {
            appendLog("\n[proofwork-terminal] resize failed: " + error.message + "\n");
          }
        }
      }
    } catch {
      if (pty) pty.write(raw.toString());
    }
  });
  ws.on("close", (code, reason) => {
    appendLog("\n[proofwork-terminal] ws close code=" + code + " reason=" + (reason?.toString() || "") + "\n");
    clearInterval(heartbeat);
    if (activeWs === ws) {
      activeWs = null;
    }
    // Intentionally NOT killing the pty here — keep opencode alive
    // for the next reconnect (tab refocus, network blip, etc.).
  });
});

server.listen(port, "0.0.0.0", () => {
  appendLog("[proofwork-terminal] listening on " + port + "\n");
});
