import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function withTempDir(run: (root: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-guard-"));

  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Git in a scratch repository, isolated from the user's identity, signing and hooks. */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Guard Test",
      "-c",
      "user.email=guard@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
}

export function writeRepoFile(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
}
