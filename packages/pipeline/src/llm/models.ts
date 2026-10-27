import type { Config } from "../config.js";

/**
 * Stages that are judgment rather than bulk work: the telegram's two calls, the second merge pass over the events the
 * word is made from (decision 108), and 2DayAI's per-reader headline. Few tokens, the most care. They use
 * MODEL_TELEGRAM and may reason (decisions 28 and 35).
 */
export function isJudgment(stage: string): boolean {
  return stage.startsWith("telegram") || stage === "select" || stage === "cluster-world-merge-top";
}

/**
 * Stages that reason at high effort. The second merge pass (decision 108) is a judgment stage that keeps the word's
 * model, but it reasons at the bulk stages' low effort (decision 154): at high effort it was a third of a clean day's
 * spend and ran out of output tokens on heavy days.
 */
export function reasonsHard(stage: string): boolean {
  return isJudgment(stage) && stage !== "cluster-world-merge-top";
}

export function modelFor(config: Pick<Config, "model" | "telegramModel">, stage: string): string {
  return isJudgment(stage) ? config.telegramModel : config.model;
}
