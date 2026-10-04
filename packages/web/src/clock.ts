// The site's clock (decision 91). GitHub's own schedule started the daily run hours late or not at all, so
// Cloudflare's cron triggers, which fire on time, ask GitHub to start the runs. GitHub's schedule stays only as the
// daily run's backup; whichever start comes second finds the day built and does nothing.

/**
 * The cron lines in wrangler.toml's [triggers]. The day ends at midnight in New York (decision 127), which is 04:00 UTC
 * in summer time and 05:00 in winter, and cron lines are UTC, so the daily run is asked for at both 04:07 and 05:07:
 * the first that comes after midnight there builds the day, and the other finds it built and does nothing.
 */
export const CRON_DAILY = "7 4 * * *";
export const CRON_DAILY_WINTER = "7 5 * * *";
export const CRON_REFRESH = "41 */3 * * *";

const REPO = "hzsl777/capy";

/** GITHUB_DISPATCH_TOKEN: a fine-grained token for this repository only, with Actions: read and write. */
export type ClockEnv = { GITHUB_DISPATCH_TOKEN?: string };

/** The workflow a cron line starts, with its inputs. */
export function runFor(cron: string): { workflow: string; inputs: Record<string, string> } | null {
  if (cron === CRON_DAILY || cron === CRON_DAILY_WINTER) return { workflow: "daily.yml", inputs: { if_missing: "true" } };
  if (cron === CRON_REFRESH) return { workflow: "refresh.yml", inputs: {} };
  return null;
}

/** Asks GitHub to start the run. Throws when it can't, so the cron shows as failed in Cloudflare's dashboard. */
export async function startRun(cron: string, env: ClockEnv, fetcher: typeof fetch = fetch): Promise<string> {
  const run = runFor(cron);
  if (!run) throw new Error(`no run for the cron line "${cron}"`);
  if (!env.GITHUB_DISPATCH_TOKEN) throw new Error("GITHUB_DISPATCH_TOKEN is not set; see docs/RUNBOOK.md, 'The clock'");
  const res = await fetcher(`https://api.github.com/repos/${REPO}/actions/workflows/${run.workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "globalgist-clock",
    },
    body: JSON.stringify({ ref: "main", inputs: run.inputs }),
  });
  if (res.status !== 204) throw new Error(`GitHub answered ${res.status} when asked to start ${run.workflow}`);
  return `started ${run.workflow}`;
}
