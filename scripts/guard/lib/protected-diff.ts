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
  /^docs\/decisions\//u,
  /^fixtures\//u,
  /^apps\/web\/e2e\/__screenshots__\//u,
];

/** Content of a changed ADR at HEAD, or undefined when the diff deleted it. */
type AdrReader = (path: string) => string | undefined;

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
  readAdr: AdrReader,
): readonly string[] {
  const changedAdrs = changed.filter((file) => adrPattern.test(file));
  const named = changedAdrs.flatMap((adr) => backtickedPaths(readAdr(adr) ?? ""));
  const findings: string[] = [];

  for (const file of changed) {
    if (!protectedPatterns.some((pattern) => pattern.test(file))) {
      continue;
    }

    if (changedAdrs.length === 0) {
      findings.push(`${file}: protected file changed without an ADR in the same diff`);
    } else if (!file.startsWith(decisionsDirectory) && !namesPath(named, file)) {
      findings.push(
        `${file}: protected file changed, but no ADR in the same diff names \`${file}\` or its directory prefix (changed ADRs: ${changedAdrs.join(", ")})`,
      );
    }
  }

  return findings;
}

function readAdrAtHead(path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

export function checkProtectedDiff(base: string): readonly string[] {
  if (process.env.GUARD_ALLOW_PROTECTED === "baseline-update") {
    return [];
  }

  const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });

  const changed = output.split(/\r?\n/u).filter((line) => line.length > 0);

  return protectedDiffFindings(changed, readAdrAtHead);
}
