import { checkCommitTrailers, readCommitRange } from "./lib/commit-trailers.ts";
import { checkDependencyRegister } from "./lib/dependencies.ts";
import { checkLintConfigs } from "./lib/lint-configs.ts";
import { checkProtectedDiff } from "./lib/protected-diff.ts";
import { checkTypeScriptConfigs } from "./lib/tsconfig.ts";
import { scanEscapeHatches } from "./lib/escape-hatches.ts";

export { checkCommitTrailers, readCommitRange } from "./lib/commit-trailers.ts";

export { checkDependencyRegister } from "./lib/dependencies.ts";

export { checkLintConfigs } from "./lib/lint-configs.ts";

export {
  addedLinesByFile,
  checkProtectedDiff,
  protectedDiffFindings,
} from "./lib/protected-diff.ts";

export { checkTypeScriptConfigs } from "./lib/tsconfig.ts";

export { expectedBaseCompilerOptions } from "./lib/tsconfig.ts";

export { scanEscapeHatches } from "./lib/escape-hatches.ts";

export function runGuard(root: string = process.cwd()): readonly string[] {
  const findings = [
    ...scanEscapeHatches(root).map(
      (finding) => `${finding.file}:${finding.line}: ${finding.message}`,
    ),
    ...checkTypeScriptConfigs(root),
    ...checkLintConfigs(root),
    ...checkDependencyRegister(root),
  ];

  // Set only on pull_request runs (check.yml). Pushes to main skip both diff checks: GitHub writes the squash
  // commit and copies branch trailers into its body, so the PR range is the only place authors control.
  const diffBase = process.env.GUARD_DIFF_BASE;

  if (diffBase !== undefined) {
    return [
      ...findings,
      ...checkProtectedDiff(diffBase),
      ...checkCommitTrailers(readCommitRange(diffBase)),
    ];
  }

  return findings;
}

export function runGuardCli(): void {
  const findings = runGuard();

  for (const finding of findings) {
    console.error(`guard: ${finding}`);
  }

  if (findings.length > 0) {
    process.exitCode = 1;

    return;
  }

  process.stdout.write(
    "guard: no escape hatches, no loosened configs, all dependencies registered\n",
  );
}
