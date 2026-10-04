import { describe, expect, it } from "vitest";
import { CRON_DAILY, CRON_DAILY_WINTER, CRON_REFRESH, runFor, startRun } from "./clock.js";

type Call = { url: string; init: RequestInit };
const answering = (status: number, calls: Call[]) =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;

describe("the site's clock (decision 91)", () => {
  it("starts the daily run only if its day is missing, and the refresh as it is", () => {
    expect(runFor(CRON_DAILY)).toEqual({ workflow: "daily.yml", inputs: { if_missing: "true" } });
    expect(runFor(CRON_DAILY_WINTER)).toEqual({ workflow: "daily.yml", inputs: { if_missing: "true" } });
    expect(runFor(CRON_REFRESH)).toEqual({ workflow: "refresh.yml", inputs: {} });
    expect(runFor("0 0 * * *")).toBeNull();
  });

  it("asks GitHub to start the workflow on main with the token", async () => {
    const calls: Call[] = [];
    expect(await startRun(CRON_DAILY, { GITHUB_DISPATCH_TOKEN: "t0ken" }, answering(204, calls))).toBe("started daily.yml");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/hzsl777/capy/actions/workflows/daily.yml/dispatches");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t0ken");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ref: "main", inputs: { if_missing: "true" } });
  });

  it("fails loudly without a token or when GitHub refuses, and calls nothing for an unknown line", async () => {
    const calls: Call[] = [];
    await expect(startRun(CRON_REFRESH, {}, answering(204, calls))).rejects.toThrow(/GITHUB_DISPATCH_TOKEN is not set/);
    await expect(startRun(CRON_REFRESH, { GITHUB_DISPATCH_TOKEN: "t" }, answering(401, calls))).rejects.toThrow(/GitHub answered 401 when asked to start refresh\.yml/);
    await expect(startRun("1 1 * * *", { GITHUB_DISPATCH_TOKEN: "t" }, answering(204, calls))).rejects.toThrow(/no run for the cron line/);
    expect(calls).toHaveLength(1);
  });
});
