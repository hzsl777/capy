import type { Config } from "../config.js";

/**
 * Stages that are judgment rather than bulk work: the telegram's two calls, the second merge pass over the events the
 * word is made from (decision 108), and 2DayAI's per-reader headline. Few tokens, the most care. They use
 * MODEL_TELEGRAM and may reason (decisions 28 and 35).
 */
export function isJudgment(stage: string): boolean {
  return stage.startsWith("telegram") || stage === "select" || stage === "cluster-world-merge-top";
}

export function modelFor(config: Pick<Config, "model" | "telegramModel">, stage: string): string {
  return isJudgment(stage) ? config.telegramModel : config.model;
}
