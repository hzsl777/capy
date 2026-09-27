// Enforces the dependency rules in docs/SPEC.md section 8.
// core imports nothing from the workspace. db imports core. pipeline and web import core and db.
// Only packages/pipeline/src/llm/ may import the Anthropic SDK.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ALLOWED = {
  core: [],
  db: ["core"],
  pipeline: ["core", "db"],
  web: ["core", "db"],
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const IMPORT_RE = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const violations = [];

for (const pkg of Object.keys(ALLOWED)) {
  const src = join(ROOT, "packages", pkg, "src");
  let files = [];
  try {
    files = walk(src);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const ws = spec.match(/^@2dayai\/([a-z]+)/);
      if (ws && !ALLOWED[pkg].includes(ws[1])) {
        violations.push(`${rel}: ${pkg} may not import @2dayai/${ws[1]}`);
      }
      if (spec.startsWith("@anthropic-ai/sdk") && !rel.startsWith("packages/pipeline/src/llm/")) {
        violations.push(`${rel}: only packages/pipeline/src/llm/ may import the Anthropic SDK`);
      }
    }
  }
}

if (violations.length) {
  console.error("Boundary violations:\n" + violations.map((v) => "  " + v).join("\n"));
  process.exit(1);
}
console.log("Boundaries clean.");
