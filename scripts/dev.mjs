// `npm run dev`: starts the web app, and the local Server too when API_URL
// points at localhost and nothing is listening there yet.
// Server checkout defaults to ../server; override with SERVER_DIR.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function readApiUrl() {
  if (process.env.API_URL) return process.env.API_URL;
  const envFile = path.join(root, ".env.local");
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*API_URL\s*=/.test(l));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : null;
}

function isListening(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

function run(cwd, command) {
  return spawn(command, { cwd, stdio: "inherit", shell: true });
}

const children = [];
const apiUrl = readApiUrl();
const url = apiUrl ? new URL(apiUrl) : null;
const isLocal = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

if (isLocal) {
  const port = Number(url.port || 80);
  const serverDir = path.resolve(root, process.env.SERVER_DIR ?? "../server");
  if (await isListening(port, "localhost")) {
    console.log(`Server already running at ${apiUrl}`);
  } else if (existsSync(path.join(serverDir, "package.json"))) {
    console.log(`Starting the Server in ${serverDir} (${apiUrl})`);
    children.push(run(serverDir, "npm run dev"));
  } else {
    console.warn(`API_URL is ${apiUrl} but nothing is listening and no Server checkout was found at ${serverDir}. Set SERVER_DIR or start it yourself.`);
  }
}

const web = run(root, "npx next dev");
children.push(web);

function stopAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
web.on("exit", (code) => { stopAll(); process.exit(code ?? 0); });
