#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const staticDir = join(out, "_next/static");
const budget = 900 * 1024;
function list(path, extension) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Bundle inputs must not be symbolic links.");
    if (entry.isDirectory()) files.push(...list(child, extension));
    else if (entry.isFile() && child.endsWith(extension)) files.push(child);
  }
  return files;
}
try {
  if (!existsSync(staticDir) || lstatSync(staticDir).isSymbolicLink()) throw new Error("Build the static export before checking its bundle.");
  const sizes = new Map(list(staticDir, ".js").map((path) => [relative(out, path).replaceAll("\\", "/"), gzipSync(readFileSync(path)).length]));
  if (!sizes.size) throw new Error("The export contains no JavaScript assets.");
  const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  for (const path of list(out, ".html")) {
    const html = readFileSync(path, "utf8");
    const referenced = new Set();
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/g)) {
      const asset = new URL(match[1], "https://export.invalid/").pathname.replace(/^\//, "");
      if (sizes.has(asset)) referenced.add(asset);
    }
    const bytes = [...referenced].reduce((sum, asset) => sum + sizes.get(asset), 0);
    console.log(`${relative(out, path)}: ${(bytes / 1024).toFixed(1)} KiB gzip of initial JavaScript (${referenced.size} assets)`);
  }
  console.log(`All static JavaScript: ${(total / 1024).toFixed(1)} KiB gzip; budget ${(budget / 1024).toFixed(0)} KiB.`);
  if (total > budget) throw new Error("Static JavaScript exceeds the bundle budget.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
