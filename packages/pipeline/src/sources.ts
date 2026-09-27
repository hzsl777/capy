import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { SourcesFileSchema, type Source } from "@2dayai/core";

export function loadSources(path = "config/sources.yaml"): Source[] {
  const raw = parse(readFileSync(path, "utf8"));
  return SourcesFileSchema.parse(raw).sources;
}
