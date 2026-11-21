/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

const CONFIG_PATHS: readonly string[] = [
  "mise.toml",
  "pnpm-lock.yaml",
  "apps/web/playwright.config.ts",
  "apps/web/vite.config.ts",
];

function hashFiles(root: string, paths: readonly string[]) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex"),
    })),
  );
}

export async function nativeSourceStamp() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

  const git = (...args: readonly string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

  const paths = git("ls-files", "apps", "packages")
    .split("\n")
    .filter((path) => path.includes("/src/"));

  const sourceHashes = await hashFiles(root, paths);

  const treePaths = [
    "apps/web/src/world",
    "apps/web/src/game",
    "apps/server/src",
    "packages/shared/src",
    "packages/engine/src",
    "packages/rules/src",
  ];

  const selectedPaths = new Set([
    "apps/web/src/world/render-worker.ts",
    "apps/web/src/world/render-loop.ts",
    "apps/web/src/world/render-link.ts",
    "apps/web/src/world/scene-core.ts",
    "apps/web/src/game/engine-worker.ts",
  ]);

  const configHashes = await hashFiles(root, CONFIG_PATHS);

  return {
    checkoutSha: git("rev-parse", "HEAD"),
    checkoutParents: git("show", "-s", "--format=%P", "HEAD").split(" "),
    runId: process.env["GITHUB_RUN_ID"] ?? "local",
    workflowSha: process.env["GITHUB_SHA"] ?? "local",
    sourceFileCount: sourceHashes.length,
    sourceManifestSha256: createHash("sha256").update(JSON.stringify(sourceHashes)).digest("hex"),
    dirtySourcePaths: git("diff", "--name-only", "HEAD", "--", "apps", "packages")
      .split("\n")
      .filter((path) => path.includes("/src/")),
    trees: treePaths.map((path) => ({ path, gitTree: git("rev-parse", `HEAD:${path}`) })),
    selectedSources: sourceHashes.filter((entry: Readonly<{ path: string; sha256: string }>) =>
      selectedPaths.has(entry.path),
    ),
    configHashes,
  };
}
