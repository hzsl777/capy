import { describe, expect, it } from "vitest";
import { toRunDate } from "@2dayai/core";
import { loadConfig } from "./config.js";
import { isPromptName, playgroundView, PROMPT_CALLS, sampleInputs } from "./prompt-view.js";

const openai = loadConfig({ LLM_PROVIDER: "openai" });

describe("the prompt command (docs/PROMPTS.md)", () => {
  it("shows the system message as sent, with the model and reasoning each call uses", () => {
    const score = playgroundView(openai, "telegram-score");
    expect(score).toMatchObject({ label: "telegram-score.v1", model: "gpt-5.4-mini", reasoningEffort: "high" });
    expect(score.system).toMatch(/^You score the day's world news/);
    expect(score.system).toMatch(/It must match this JSON Schema:\n\{/);
    expect(playgroundView(openai, "cluster-world")).toMatchObject({ label: "cluster-world.v4", model: "gpt-5.4-nano", reasoningEffort: "low" });
    expect(playgroundView(openai, "select")).toMatchObject({ model: "gpt-5.4-mini", reasoningEffort: "high" });
    expect(isPromptName("telegram-score")).toBe(true);
    expect(isPromptName("telegram")).toBe(false);
  });

  it("has a sample input from the fictional day for every world-desk call", async () => {
    const samples = await sampleInputs(openai, toRunDate("2026-09-27"));
    for (const name of ["cluster-world", "cluster-world-merge", "explain", "telegram-score", "telegram-word"]) expect(samples.get(name), name).toBeTruthy();
    expect(samples.get("telegram-score")).toMatch(/^Run date: 2026-09-27\. World events with verified explanations, 7 in total/);
    expect(samples.has("select")).toBe(false);
    expect(Object.keys(PROMPT_CALLS)).toHaveLength(7);
  }, 60_000);
});
