import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  addedLinesByFile,
  checkCommitTrailers,
  checkProtectedDiff,
  protectedDiffFindings,
  readCommitRange,
} from "./main.ts";
import { commitAll, git, withTempDir, writeRepoFile } from "./test-support.ts";

const adr007 = "docs/decisions/ADR-007-guardrails-tooling.md";
const adr034 = "docs/decisions/ADR-034-hardware-capture-fixtures.md";
const adr036 = "docs/decisions/ADR-036-merge-gates.md";

/** Every protected path this PR changes; ADR-036 must unlock each one through its own lines. */
const adr036ProtectedPaths = [
  ".github/CODEOWNERS",
  ".github/workflows/deploy-web.yml",
  ".github/workflows/mutation.yml",
  "scripts/guard.test.mjs",
  "scripts/guard/lib/commit-trailers.ts",
  "scripts/guard/lib/escape-hatches.ts",
  "scripts/guard/lib/protected-diff.ts",
  "scripts/guard/main.ts",
  "scripts/guard/merge-gate-tests.ts",
  "scripts/guard/test-support.ts",
  "scripts/guard/tests.ts",
  "stryker.config.json",
];

function repoText(path: string): string {
  return readFileSync(path, "utf8");
}

/** A scratch repo whose `base` branch holds the given files, checked out on a branch off `base`. */
function withBaseRepo(files: Readonly<Record<string, string>>, run: (root: string) => void): void {
  withTempDir((root) => {
    git(root, ["init", "-q", "-b", "main"]);

    for (const [path, content] of Object.entries(files)) {
      writeRepoFile(root, path, content);
    }

    commitAll(root, "chore: base");
    git(root, ["branch", "base"]);
    run(root);
  });
}

await test("protectedDiffFindings fails a protected change without any ADR", () => {
  assert.deepEqual(protectedDiffFindings(["mise.toml", "README.md"], []), [
    "mise.toml: protected file changed without an ADR in the same diff",
  ]);
});

await test("protectedDiffFindings names the missing path and reads only added ADR lines", () => {
  const changed = [adr036, "docs/decisions/README.md", "mise.toml", ".github/workflows/x.yml"];

  const added = [
    { path: adr036, added: "Ändert `.github/workflows/`; `fixtures/ble` ohne Slash." },
  ];

  assert.deepEqual(protectedDiffFindings(changed, added), [
    "mise.toml: protected file changed, but no line the diff adds to an ADR names `mise.toml` or its directory prefix (changed ADRs: docs/decisions/ADR-036-merge-gates.md)",
  ]);
});

await test("addedLinesByFile keeps '+++' inside a hunk as an added line, not a header", () => {
  const diff = [
    "diff --git a/docs/decisions/ADR-1.md b/docs/decisions/ADR-1.md",
    "--- a/docs/decisions/ADR-1.md",
    "+++ b/docs/decisions/ADR-1.md",
    "@@ -1 +1,2 @@",
    "-old `mise.toml`",
    "+new",
    "+++ b/`oxlint.config.ts`",
    "diff --git a/docs/decisions/ADR-2.md b/docs/decisions/ADR-2.md",
    "deleted file mode 100644",
    "--- a/docs/decisions/ADR-2.md",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-`tsconfig.base.json`",
    "",
  ].join("\n");

  assert.deepEqual(addedLinesByFile(diff), [
    { path: "docs/decisions/ADR-1.md", added: "new\n++ b/`oxlint.config.ts`" },
  ]);
});

await test("an ADR-007 typo fix does not unlock mise.toml or oxlint.config.ts that ADR-007 names", () => {
  const text = repoText(adr007);

  assert.ok(text.includes("`mise.toml`"));
  assert.ok(text.includes("`oxlint.config.ts`"));

  withBaseRepo({ [adr007]: text, "mise.toml": "[tools]\n", "oxlint.config.ts": "x\n" }, (root) => {
    writeRepoFile(root, adr007, text.replace("großteils", "grösstenteils"));
    writeRepoFile(root, "mise.toml", "[tools]\nnode = '0'\n");
    writeRepoFile(root, "oxlint.config.ts", "y\n");
    commitAll(root, "docs: typo");

    const findings = checkProtectedDiff("base", root);

    assert.equal(findings.length, 2);
    assert.ok(findings[0]?.startsWith("mise.toml: protected file changed, but no line"));
    assert.ok(findings[1]?.startsWith("oxlint.config.ts: protected file changed, but no line"));
  });
});

await test("an ADR-034 typo fix does not unlock the guard through ADR-034's `scripts/`", () => {
  const text = repoText(adr034);
  const guardFile = "scripts/guard/lib/protected-diff.ts";

  assert.ok(text.includes("`scripts/`"));

  withBaseRepo({ [adr034]: text, [guardFile]: "export {};\n" }, (root) => {
    writeRepoFile(root, adr034, text.replace("Mitschnitte", "Mitschnite"));
    writeRepoFile(root, guardFile, "export const loosened = true;\n");
    commitAll(root, "docs: typo");

    assert.deepEqual(
      checkProtectedDiff("base", root).map((finding) => finding.split(":")[0]),
      [guardFile],
    );
  });
});

await test("a stryker.config.json change needs an ADR line naming it", () => {
  withBaseRepo({ "stryker.config.json": '{ "break": 80 }\n', [adr007]: "ADR\n" }, (root) => {
    writeRepoFile(root, "stryker.config.json", '{ "break": 0 }\n');
    commitAll(root, "ci: lower break");
    assert.deepEqual(checkProtectedDiff("base", root), [
      "stryker.config.json: protected file changed without an ADR in the same diff",
    ]);

    writeRepoFile(root, adr007, "ADR\nSenkt die Schwelle in `stryker.config.json`.\n");
    commitAll(root, "docs: record");
    assert.deepEqual(checkProtectedDiff("base", root), []);
  });
});

await test("the new ADR-036 unlocks every protected path this PR changes, and nothing else", () => {
  const text = repoText(adr036);

  withBaseRepo({ "README.md": "base\n" }, (root) => {
    writeRepoFile(root, adr036, text);
    writeRepoFile(root, "docs/decisions/README.md", "index\n");

    for (const path of [...adr036ProtectedPaths, "mise.toml"]) {
      writeRepoFile(root, path, "changed\n");
    }

    commitAll(root, "chore: merge gates");

    assert.deepEqual(
      checkProtectedDiff("base", root).map((finding) => finding.split(":")[0]),
      ["mise.toml"],
    );
  });
});

function commit(root: string, file: string, message: string, author?: string): void {
  writeRepoFile(root, file, message);
  git(root, ["add", file]);
  git(root, [
    "commit",
    "-q",
    ...(author === undefined ? [] : [`--author=${author}`]),
    "-m",
    message,
  ]);
}

const signed = "Signed-off-by: Guard Test <guard@example.invalid>";

/** A `base` branch, then signed, unsigned, AI-trailer, prose-only, AI-author and human-Claude commits, then a merge. */
function buildTrailerHistory(root: string): void {
  git(root, ["init", "-q", "-b", "main"]);
  commit(root, "base.txt", "chore: base");
  git(root, ["branch", "base"]);
  commit(root, "a.txt", `feat: signed\n\n${signed}`);
  commit(
    root,
    "b.txt",
    `feat: human co-author\n\nCo-authored-by: Franz <f@example.invalid>\n${signed}`,
  );
  commit(root, "c.txt", "fix: unsigned");
  commit(
    root,
    "d.txt",
    `fix: agent\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_x\n${signed}`,
  );
  commit(
    root,
    "e.txt",
    `docs: mention only\n\nCo-Authored-By: Claude <noreply@anthropic.com> is prose here.\n\n${signed}`,
  );
  commit(root, "g.txt", `feat: agent author\n\n${signed}`, "Claude <noreply@anthropic.com>");
  commit(
    root,
    "h.txt",
    `feat: a person named Claude\n\nCo-authored-by: Claude Martin <claude.martin@example.com>\nSigned-off-by: Claude Martin <claude.martin@example.com>`,
    "Claude Martin <claude.martin@example.com>",
  );
  git(root, ["checkout", "-q", "-b", "side", "base"]);
  commit(root, "f.txt", `chore: side\n\n${signed}`);
  git(root, ["checkout", "-q", "main"]);
  git(root, ["merge", "-q", "--no-ff", "--no-edit", "side"]);
}

await test("checkCommitTrailers needs Signed-off-by and rejects Anthropic identities, not people named Claude", () => {
  withTempDir((root) => {
    buildTrailerHistory(root);

    const findings = checkCommitTrailers(readCommitRange("base", "HEAD", root));

    assert.deepEqual(
      findings.map((finding) => finding.replace(/^commit [0-9a-f]{7} /u, "")),
      [
        '"feat: agent author": author noreply@anthropic.com is an AI identity; commit as a person',
        "\"fix: agent\": forbidden trailer 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'",
        "\"fix: agent\": forbidden trailer 'Claude-Session: https://claude.ai/code/session_x'",
        '"fix: unsigned": missing Signed-off-by trailer (commit with -s)',
      ],
    );
  });
});

function hasCommits(shas: readonly string[]): boolean {
  try {
    for (const sha of shas) {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    }

    return true;
  } catch {
    return false;
  }
}

// Real main commits. A shallow clone lacks them (CI checks out with fetch-depth 0; local or other
// tooling might not), so the test reports a skip with the reason instead of failing on missing history.
const mainHistory = ["a470bd1", "a470bd1^", "2ec2dee", "2ec2dee^", "dc0f2e0", "dc0f2e0^"];

const missingHistory = hasCommits(mainHistory)
  ? false
  : `main history ${mainHistory.join(", ")} not in this clone; fetch full history to run`;

await test(
  "checkCommitTrailers fails Franz's #174 squash a470bd1 and passes GitHub squashes 2ec2dee, dc0f2e0",
  { skip: missingHistory },
  () => {
    assert.deepEqual(checkCommitTrailers(readCommitRange("a470bd1^", "a470bd1")), [
      "commit a470bd1 \"feat(world): connected world voltonaut with regions and a tour (#174)\": forbidden trailer 'Co-authored-by: Claude <noreply@anthropic.com>'",
    ]);
    assert.deepEqual(checkCommitTrailers(readCommitRange("2ec2dee^", "2ec2dee")), []);
    assert.deepEqual(checkCommitTrailers(readCommitRange("dc0f2e0^", "dc0f2e0")), []);
  },
);
