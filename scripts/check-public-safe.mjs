#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const self = fileURLToPath(import.meta.url);
// Only this literal data list is exempt from identifier matching.
export const banned = [
  "@neondatabase", "DATABASE_URL", "@openrouter", "OPENROUTER_API_KEY",
  "openrouter.ai", "@vercel/blob", "BLOB_READ_WRITE_TOKEN", '"resend"', "'resend'", "RESEND_API_KEY", "api.resend.com", "EMAIL_FROM",
  "next-auth", "AUTH_SECRET", "server-only", "calm-art-22345143",
  "br-green-moon", "neon-bistre-flower", "alyana", "acosta", "@gmail.com",
  "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com",
  "api.groq.com", "api.mistral.ai", "api.deepseek.com", "api.x.ai",
  "api.cohere.com", "api.cohere.ai", "api.together.xyz", "api.fireworks.ai",
  "@ai-sdk/", "@anthropic-ai/", "@google/generative-ai", "@google/genai",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
  "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY", "COHERE_API_KEY",
  "omni-reviewer.vercel.app", "omni-reviewer.app",
];
const roots = ["app", "components", "lib", "public", "scripts", "tests", "out", ".github"];
const files = new Set();
const failures = [];
function collect(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    failures.push(`${relative(root, path)}: symbolic links are not allowed in public inputs`);
  } else if (stat.isDirectory()) {
    for (const name of readdirSync(path)) collect(join(path, name));
  } else if (stat.isFile()) {
    files.add(path);
    const name = path.split("/").at(-1);
    if (name === ".env" || name.startsWith(".env.")) failures.push(`${relative(root, path)}: environment files must remain untracked`);
  }
}
export function assertNoBannedIdentifiers(value) {
  const lower = value.toLowerCase();
  if (banned.some((token) => lower.includes(token.toLowerCase()))) {
    throw new Error("Public content contains a prohibited identifier.");
  }
}
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isMain) {
for (const name of roots) collect(join(root, name));
for (const name of readdirSync(root)) {
  if (name === "node_modules" || name === ".git" || name === ".next") continue;
  const path = join(root, name);
  if (lstatSync(path).isFile() && !name.endsWith(".tsbuildinfo")) files.add(path);
  if (name === ".env" || name.startsWith(".env.")) failures.push(`${name}: environment files must remain untracked`);
}
let scanned = 0;
for (const path of files) {
  scanned++;
  const data = readFileSync(path);
  if (data.includes(0)) continue;
  let content = data.toString("utf8");
  if (path === self) content = content.replace(/export const banned = \[[\s\S]*?\n\];/, (list) => list.replace(/[^\n\r]/g, " "));
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const token of banned) {
      if (lower.includes(token.toLowerCase())) failures.push(`${relative(root, path)}:${index + 1}: banned identifier ${token}`);
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAIza[0-9A-Za-z_-]{35}\b|\bsk-[a-zA-Z0-9_-]{20,}\b/.test(line)) {
      // Firebase browser API keys are public configuration, scoped by origin,
      // rules and App Check. Private keys and provider keys are never permitted.
      const publicFirebaseKey = path === join(root, "lib/demo/firebase.ts") || relative(root, path).startsWith("out/");
      if (!publicFirebaseKey || /PRIVATE KEY|\bsk-/.test(line)) failures.push(`${relative(root, path)}:${index + 1}: possible secret`);
    }
  });
}
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  for (const name of Object.keys(packageJson[section] ?? {})) {
    if (["ai", "openai", "anthropic", "groq-sdk", "cohere-ai"].includes(name)) failures.push(`package.json: prohibited SDK ${name}`);
  }
}
if (failures.length) {
  console.error(`Public-safety check FAILED\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Public-safety check OK — ${scanned} files scanned.`);
}
