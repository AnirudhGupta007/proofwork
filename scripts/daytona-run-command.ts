import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadDotEnv() {
  const content = await readFile(path.join(process.cwd(), ".env"), "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ??= value;
  }
}

const [externalId, ...commandParts] = process.argv.slice(2);
if (!externalId) {
  throw new Error("Usage: npx tsx scripts/daytona-run-command.ts <externalId> <command>");
}

await loadDotEnv();
const { DaytonaWorkspaceProvider } = await import("../app/lib/workspaces/daytona-provider.ts");
const provider = new DaytonaWorkspaceProvider();
const stdinCommand =
  commandParts.length === 0 && !process.stdin.isTTY
    ? await new Promise<string>((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
          data += chunk;
        });
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
      })
    : "";
const command = commandParts.length > 0 ? commandParts.join(" ") : stdinCommand;
if (!command.trim()) throw new Error("Command is required");
const result = await provider.runCommand(externalId, command, 180_000);
console.log(JSON.stringify(result, null, 2));
