import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type PromptName = "cluster" | "explain" | "select";

export type Prompt = {
  name: PromptName;
  version: number;
  /** Full text of the prompt file. It is the system prompt; user content is built by the stage. */
  system: string;
  /** Stored on every output the prompt produced (spec decision 11). */
  label: string;
};

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

/** Prompts are versioned files, never strings in code. Editing a prompt in place is a bug. */
export function loadPrompt(name: PromptName, version: number): Prompt {
  const file = join(PROMPTS_DIR, `${name}.v${version}.md`);
  const system = readFileSync(file, "utf8");
  return { name, version, system, label: `${name}.v${version}` };
}
