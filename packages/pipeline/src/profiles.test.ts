import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProfiles } from "./profiles.js";

const profile = (id: string, email: string) => `id: ${id}
email: ${email}
timezone: America/New_York
deliveryHour: 6
topics:
  - { name: international tax, weight: 5 }
stake:
  - Works in tax.
`;

describe("loadProfiles (decision 35)", () => {
  it("reads profiles from the READER_PROFILES secret as YAML documents split by ---", () => {
    const dir = mkdtempSync(join(tmpdir(), "readers-"));
    const out = loadProfiles(dir, `${profile("r01", "a@example.com")}---\n${profile("r02", "b@example.com")}`);
    expect(out.map((p) => [p.profile.id, p.profile.email])).toEqual([
      ["r01", "a@example.com"],
      ["r02", "b@example.com"],
    ]);
  });

  it("combines files and the secret, and refuses a reader defined twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "readers-"));
    writeFileSync(join(dir, "r01.yaml"), profile("r01", "a@example.com"));
    expect(loadProfiles(dir, profile("r02", "b@example.com")).map((p) => p.profile.id)).toEqual(["r01", "r02"]);
    expect(() => loadProfiles(dir, profile("r01", "c@example.com"))).toThrow(/defined twice/);
  });

  it("names a bad document without printing its content", () => {
    const dir = mkdtempSync(join(tmpdir(), "readers-"));
    let message = "";
    try {
      loadProfiles(dir, "id: r05\nemail: not-an-email\n");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/document 1 is not a valid profile/);
    expect(message).not.toContain("not-an-email");
  });

  it("accepts the example profile, so it can be copied into the secret as a starting point", () => {
    const example = readFileSync(join(import.meta.dirname, "../../../config/readers/r00.example.yaml"), "utf8");
    expect(loadProfiles(join(tmpdir(), "does-not-exist"), example).map((p) => p.profile.id)).toEqual(["r00"]);
  });

  it("works with no readers directory and no secret", () => {
    expect(loadProfiles(join(tmpdir(), "does-not-exist"), undefined)).toEqual([]);
  });
});
