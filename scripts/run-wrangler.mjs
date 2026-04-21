import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rawArgs = process.argv.slice(2);
const userArgs = [...rawArgs];

if (userArgs[1] === "--") {
  userArgs.splice(1, 1);
}

if (userArgs.length === 0) {
  console.error("Usage: node ./scripts/run-wrangler.mjs <wrangler-args>");
  process.exit(1);
}

const configPath = existsSync("wrangler.local.jsonc")
  ? "wrangler.local.jsonc"
  : "wrangler.jsonc";

const command = process.platform === "win32"
  ? resolve("node_modules/.bin/wrangler.cmd")
  : resolve("node_modules/.bin/wrangler");
const [subcommand, ...restArgs] = userArgs;
const child = spawn(command, [subcommand, "--config", configPath, ...restArgs], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});