import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { checkCommitTrailers, protectedDiffFindings, readCommitRange } from "./main.ts";
import { withTempDir } from "./temp-dir.ts";

function adrReader(adrs: Readonly<Record<string, string>>): (path: string) => string | undefined {
  return (path) => adrs[path];
}

await test("protectedDiffFindings fails a protected change without any ADR", () => {
  assert.deepEqual(protectedDiffFindings(["mise.toml", "README.md"], adrReader({})), [
    "mise.toml: protected file changed without an ADR in the same diff",
  ]);
});

await test("protectedDiffFindings rejects an ADR typo fix that does not name the protected path", () => {
  const typoFix = "docs/decisions/ADR-012-server-skiplibcheck-drizzle.md";

  const findings = protectedDiffFindings(
    [typoFix, "mise.toml"],
    adrReader({ [typoFix]: "Nur `apps/server/tsconfig.json` darf `skipLibCheck: true` setzen." }),
  );

  assert.equal(findings.length, 1);
  assert.ok(findings[0]?.startsWith("mise.toml: protected file changed, but no ADR"));
  assert.ok(findings[0]?.includes("`mise.toml`"));
  assert.ok(findings[0]?.includes(typoFix));
});

await test("protectedDiffFindings accepts exact paths and directory prefixes named in a changed ADR", () => {
  const adr = "docs/decisions/ADR-036-merge-gates.md";

  const changed = [
    adr,
    "docs/decisions/README.md",
    "mise.toml",
    ".github/workflows/mutation.yml",
    "scripts/guard/lib/protected-diff.ts",
    "fixtures/ble/new.json",
  ];

  const text =
    "Ändert `mise.toml`, `.github/workflows/` und `scripts/guard/`; `fixtures/ble` ohne Slash.";

  assert.deepEqual(protectedDiffFindings(changed, adrReader({ [adr]: text })), [
    "fixtures/ble/new.json: protected file changed, but no ADR in the same diff names `fixtures/ble/new.json` or its directory prefix (changed ADRs: docs/decisions/ADR-036-merge-gates.md)",
  ]);
});

await test("protectedDiffFindings ignores paths named only by an ADR outside the diff", () => {
  const changed = ["docs/decisions/ADR-012-server-skiplibcheck-drizzle.md", "tsconfig.base.json"];

  const findings = protectedDiffFindings(
    changed,
    adrReader({ "docs/decisions/ADR-007-guardrails-tooling.md": "`tsconfig.base.json`" }),
  );

  assert.equal(findings.length, 1);
  assert.ok(findings[0]?.startsWith("tsconfig.base.json:"));
});

function git(cwd: string, args: readonly string[]): string {
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

function commit(cwd: string, file: string, message: string, author?: string): void {
  writeFileSync(join(cwd, file), message);
  git(cwd, ["add", file]);
  git(cwd, [
    "commit",
    "-q",
    ...(author === undefined ? [] : [`--author=${author}`]),
    "-m",
    message,
  ]);
}

/** A `base` branch, then signed, unsigned, AI-trailer, prose-only and AI-author commits, then a merge. */
function buildTrailerHistory(root: string): void {
  git(root, ["init", "-q", "-b", "main"]);
  commit(root, "base.txt", "chore: base");
  git(root, ["branch", "base"]);
  commit(root, "a.txt", "feat: signed\n\nSigned-off-by: Guard Test <guard@example.invalid>");
  commit(
    root,
    "b.txt",
    "feat: human co-author\n\nCo-authored-by: Franz <franz@example.invalid>\nSigned-off-by: Guard Test <guard@example.invalid>",
  );
  commit(root, "c.txt", "fix: unsigned");
  commit(
    root,
    "d.txt",
    "fix: agent\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_x\nSigned-off-by: Guard Test <guard@example.invalid>",
  );
  commit(
    root,
    "e.txt",
    "docs: mention only\n\nCo-Authored-By: Claude is prose here, not a trailer.\n\nSigned-off-by: Guard Test <guard@example.invalid>",
  );
  commit(
    root,
    "g.txt",
    "feat: agent author\n\nSigned-off-by: Claude <noreply@anthropic.com>",
    "Claude <noreply@anthropic.com>",
  );
  git(root, ["checkout", "-q", "-b", "side", "base"]);
  commit(root, "f.txt", "chore: side\n\nSigned-off-by: Guard Test <guard@example.invalid>");
  git(root, ["checkout", "-q", "main"]);
  git(root, ["merge", "-q", "--no-ff", "--no-edit", "side"]);
}

await test("checkCommitTrailers needs Signed-off-by and rejects AI trailers, skipping merges", () => {
  withTempDir((root) => {
    buildTrailerHistory(root);

    const findings = checkCommitTrailers(readCommitRange("base", "HEAD", root));

    assert.equal(findings.length, 4);
    assert.ok(findings.some((finding) => /"fix: unsigned": missing Signed-off-by/u.test(finding)));
    assert.ok(
      findings.some((finding) =>
        finding.endsWith(
          "forbidden trailer 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'",
        ),
      ),
    );
    assert.ok(findings.some((finding) => finding.includes("forbidden trailer 'Claude-Session:")));
    assert.ok(
      findings.some((finding) =>
        finding.includes('"feat: agent author": author noreply@anthropic.com is an AI identity'),
      ),
    );
  });
});

await test("checkCommitTrailers fails Franz's #174 squash a470bd1 and passes GitHub squashes 2ec2dee, dc0f2e0", () => {
  const franz = checkCommitTrailers(readCommitRange("a470bd1^", "a470bd1"));

  assert.deepEqual(franz, [
    "commit a470bd1 \"feat(world): connected world voltonaut with regions and a tour (#174)\": forbidden trailer 'Co-authored-by: Claude <noreply@anthropic.com>'",
  ]);
  assert.deepEqual(checkCommitTrailers(readCommitRange("2ec2dee^", "2ec2dee")), []);
  assert.deepEqual(checkCommitTrailers(readCommitRange("dc0f2e0^", "dc0f2e0")), []);
});
