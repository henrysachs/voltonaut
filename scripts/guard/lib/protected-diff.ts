import { execFileSync } from "node:child_process";

const decisionsDirectory = "docs/decisions/";
const adrPattern = /^docs\/decisions\/ADR-[^/]+\.md$/u;

const protectedPatterns: readonly Readonly<RegExp>[] = [
  /^mise\.toml$/u,
  /^tsconfig.*\.json$/u,
  /^oxlint\.config\.ts$/u,
  /^tools\/oxlint\//u,
  /^\.oxfmtrc\.json$/u,
  /^\.dependency-cruiser\.cjs$/u,
  /^scripts\/guard(\.mjs|\.test\.mjs|\/|$)/u,
  /^\.github\//u,
  /^pnpm-workspace\.yaml$/u,
  /^stryker\.config\.json$/u,
  /^docs\/decisions\//u,
  /^fixtures\//u,
  /^apps\/web\/e2e\/__screenshots__\//u,
];

/**
 * Lines the diff adds to each ADR. Only these may name protected paths: a typo fix in ADR-007 must not
 * unlock every path ADR-007 has ever named. A new ADR adds all of its lines, so it counts whole.
 */
export interface AdrAddition {
  readonly path: string;
  readonly added: string;
}

/** Parses `git diff -U0` output into the added lines per post-image path. */
export function addedLinesByFile(unifiedDiff: string): readonly AdrAddition[] {
  const additions: { readonly path: string; readonly lines: string[] }[] = [];
  let current: string[] | undefined;
  // `+++ b/<path>` is a header only between `diff --git` and the first hunk; inside a hunk it is an added line.
  let inHeader = false;

  for (const line of unifiedDiff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      current = undefined;
    } else if (inHeader && line.startsWith("+++ b/")) {
      current = [];
      additions.push({ path: line.slice("+++ b/".length), lines: current });
    } else if (line.startsWith("@@")) {
      inHeader = false;
    } else if (!inHeader && line.startsWith("+") && current !== undefined) {
      current.push(line.slice(1));
    }
  }

  const result: AdrAddition[] = [];

  for (const addition of additions) {
    result.push({ path: addition.path, added: addition.lines.join("\n") });
  }

  return result;
}

function backtickedPaths(text: string): readonly string[] {
  const paths: string[] = [];

  for (const [, path] of text.matchAll(/`([^`\s]+)`/gu)) {
    if (path !== undefined) {
      paths.push(path);
    }
  }

  return paths;
}

/** An ADR names a path as `path` or by a directory prefix ending in a slash, such as `.github/workflows/`. */
function namesPath(named: readonly string[], file: string): boolean {
  return named.some((entry) => entry === file || (entry.endsWith("/") && file.startsWith(entry)));
}

export function protectedDiffFindings(
  changed: readonly string[],
  additions: readonly AdrAddition[],
): readonly string[] {
  const changedAdrs = changed.filter((file) => adrPattern.test(file));

  const named = additions
    .filter(({ path }) => changedAdrs.includes(path))
    .flatMap(({ added }) => backtickedPaths(added));

  const findings: string[] = [];

  for (const file of changed) {
    if (!protectedPatterns.some((pattern) => pattern.test(file))) {
      continue;
    }

    if (changedAdrs.length === 0) {
      findings.push(`${file}: protected file changed without an ADR in the same diff`);
    } else if (!file.startsWith(decisionsDirectory) && !namesPath(named, file)) {
      findings.push(
        `${file}: protected file changed, but no line the diff adds to an ADR names \`${file}\` or its directory prefix (changed ADRs: ${changedAdrs.join(", ")})`,
      );
    }
  }

  return findings;
}

export function checkProtectedDiff(base: string, cwd: string = process.cwd()): readonly string[] {
  if (process.env.GUARD_ALLOW_PROTECTED === "baseline-update") {
    return [];
  }

  const range = `${base}...HEAD`;

  const changed = execFileSync("git", ["diff", "--name-only", range], { cwd, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);

  // Rename detection over the whole directory, so a renamed ADR adds only its edited lines.
  const adrDiff = execFileSync(
    "git",
    ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", range, "--", decisionsDirectory],
    { cwd, encoding: "utf8" },
  );

  return protectedDiffFindings(changed, addedLinesByFile(adrDiff));
}
