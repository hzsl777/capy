import type { Config } from "../config.js";

/** The telegram's two calls may use a stronger model than the bulk stages (decision 28). */
export function modelFor(config: Pick<Config, "model" | "telegramModel">, stage: string): string {
  return stage.startsWith("telegram") ? config.telegramModel : config.model;
}
