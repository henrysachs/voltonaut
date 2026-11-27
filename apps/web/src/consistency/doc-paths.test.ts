import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  ".stryker-tmp",
]);

function filesBelow(directory: string): readonly string[] {
  const files: string[] = [];

  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...filesBelow(path));
    } else {
      files.push(path);
    }
  }

  return files;
}

const DOCS: readonly string[] = [
  "AGENTS.md",
  "README.md",
  "GLOSSARY.md",
  ...filesBelow("docs").filter((file) => file.endsWith(".md")),
];

const WORKSPACES: readonly string[] = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(ROOT, group)).map((name) => `${group}/${name}`),
);

const WORKSPACE_FILES: readonly string[] = WORKSPACES.flatMap((workspace) => filesBelow(workspace));

/** `sim/fakeTrainer.ts` style paths start with a top-level folder of some workspace `src/`. */
function sourceFolders(): ReadonlySet<string> {
  const folders = new Set<string>();

  for (const workspace of WORKSPACES) {
    const source = join(ROOT, workspace, "src");

    if (!existsSync(source)) continue;

    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isDirectory()) folders.add(entry.name);
    }
  }

  return folders;
}

const SOURCE_FOLDERS = sourceFolders();

const REPO_FOLDERS: ReadonlySet<string> = new Set([
  "apps",
  "packages",
  "scripts",
  "docs",
  "fixtures",
  "tools",
]);

const SOURCE_EXTENSION = /\.(?:ts|mts|js|mjs|cjs|json|md|html|css|sql|ya?ml|toml|sh)$/u;

/**
 * What a backticked text names. Repo paths (`apps/…`, `docs/…`) are checked as written;
 * workspace-relative paths (`sim/fakeTrainer.ts`) must end some workspace file. Globs,
 * placeholders and generated outputs (`dist/main.js`) are not file references.
 */
function fileReference(text: string): "none" | "present" | "missing" {
  const path = text.replace(/(?::\d+(?:[-–]\d+)?|#[\w-]+)$/u, "");

  if (!/^[\w.@-]+(?:\/[\w.@-]+)+$/u.test(path) || !SOURCE_EXTENSION.test(path)) return "none";

  const folder = path.split("/", 1)[0] ?? "";

  if (REPO_FOLDERS.has(folder)) return existsSync(join(ROOT, path)) ? "present" : "missing";

  if (!SOURCE_FOLDERS.has(folder)) return "none";

  return WORKSPACE_FILES.some((file) => file.endsWith(`/${path}`)) ? "present" : "missing";
}

/**
 * Findings for one doc line (docs/10-testing.md §10):
 * - a plan line `- Create: …` names files that do not exist yet and is skipped;
 * - a removed file is struck through, ~~`path`~~, so history stays readable; a struck path that
 *   still exists hides a live reference and fails;
 * - every other named file must exist.
 */
function lineFindings(where: string, line: string): readonly string[] {
  if (/^\s*- Create:/u.test(line)) return [];

  const findings: string[] = [];

  for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    const struck = line.slice(start - 2, start) === "~~" && line.slice(end, end + 2) === "~~";
    const text = match[1] ?? "";
    const reference = fileReference(text);

    if (struck && reference === "present") {
      findings.push(`${where}: struck but present: \`${text}\`; drop the strike-through`);
    } else if (!struck && reference === "missing") {
      findings.push(`${where}: \`${text}\` is missing; name its new path or strike it`);
    }
  }

  return findings;
}

function brokenReferences(): readonly string[] {
  const findings: string[] = [];

  for (const doc of DOCS) {
    for (const [index, line] of readFileSync(join(ROOT, doc), "utf8").split("\n").entries()) {
      findings.push(...lineFindings(`${doc}:${index + 1}`, line));
    }
  }

  return findings;
}

it("names only files that exist in docs, AGENTS.md, README.md and GLOSSARY.md", () => {
  expect(brokenReferences()).toEqual([]);
});

it("rejects a missing path unless it is struck through or planned", () => {
  expect(lineFindings("probe", "see `apps/web/src/ridePresentation.ts`")).toEqual([
    "probe: `apps/web/src/ridePresentation.ts` is missing; name its new path or strike it",
  ]);
  expect(lineFindings("probe", "see ~~`apps/web/src/ridePresentation.ts`~~")).toEqual([]);
  expect(lineFindings("probe", "- Create: `apps/web/src/ridePresentation.ts`")).toEqual([]);
});

it("rejects a struck-through path that still exists", () => {
  expect(lineFindings("probe", "see ~~`apps/web/src/main.ts`~~ and ~~`sim/clock.ts`~~")).toEqual([
    "probe: struck but present: `apps/web/src/main.ts`; drop the strike-through",
    "probe: struck but present: `sim/clock.ts`; drop the strike-through",
  ]);
});
