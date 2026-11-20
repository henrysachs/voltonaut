import { execFileSync } from "node:child_process";

const protectedPatterns: readonly RegExp[] = [
  /^mise\.toml$/u,
  /^tsconfig.*\.json$/u,
  /^oxlint\.config\.ts$/u,
  /^tools\/oxlint\//u,
  /^\.oxfmtrc\.json$/u,
  /^\.dependency-cruiser\.cjs$/u,
  /^scripts\/guard(\.mjs|\/|$)/u,
  /^\.github\//u,
  /^pnpm-workspace\.yaml$/u,
  /^docs\/decisions\//u,
  /^fixtures\//u,
  /^apps\/web\/e2e\/__screenshots__\//u,
];

export function checkProtectedDiff(base: string): readonly string[] {
  if (process.env.GUARD_ALLOW_PROTECTED === "baseline-update") {
    return [];
  }

  const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });

  const changed = output.split(/\r?\n/u).filter((line) => line.length > 0);
  const adrChanged = changed.some((file) => file.startsWith("docs/decisions/ADR-"));

  if (adrChanged) {
    return [];
  }

  const findings: string[] = [];

  for (const file of changed) {
    for (const pattern of protectedPatterns) {
      if (pattern.test(file)) {
        findings.push(`${file}: protected file changed without an ADR in the same diff`);
      }
    }
  }

  return findings;
}
