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
 * Whether a backticked text names a file that must exist. Repo paths (`apps/…`, `docs/…`) must
 * exist as written; workspace-relative paths (`sim/fakeTrainer.ts`) must end some workspace file.
 * Globs, placeholders and generated outputs (`dist/main.js`) are not file references.
 */
function missingFile(text: string): boolean {
  const path = text.replace(/(?::\d+(?:[-–]\d+)?|#[\w-]+)$/u, "");

  if (!/^[\w.@-]+(?:\/[\w.@-]+)+$/u.test(path) || !SOURCE_EXTENSION.test(path)) return false;

  const folder = path.split("/", 1)[0] ?? "";

  if (REPO_FOLDERS.has(folder)) return !existsSync(join(ROOT, path));

  return SOURCE_FOLDERS.has(folder) && !WORKSPACE_FILES.some((file) => file.endsWith(`/${path}`));
}

/**
 * Two forms are exempt (docs/10-testing.md §10):
 * - a plan line `- Create: …` names files that do not exist yet;
 * - a removed file is struck through, ~~`path`~~, so history stays readable.
 */
function brokenReferences(): readonly string[] {
  const findings: string[] = [];

  for (const doc of DOCS) {
    for (const [index, line] of readFileSync(join(ROOT, doc), "utf8").split("\n").entries()) {
      if (/^\s*- Create:/u.test(line)) continue;

      for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
        const start = match.index;
        const end = start + match[0].length;
        const struck = line.slice(start - 2, start) === "~~" && line.slice(end, end + 2) === "~~";
        const text = match[1] ?? "";

        if (!struck && missingFile(text)) {
          findings.push(
            `${doc}:${index + 1}: \`${text}\` is missing; name its new path or strike it`,
          );
        }
      }
    }
  }

  return findings;
}

it("names only files that exist in docs, AGENTS.md, README.md and GLOSSARY.md", () => {
  expect(brokenReferences()).toEqual([]);
});
