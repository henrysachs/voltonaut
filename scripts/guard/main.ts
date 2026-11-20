import { checkDependencyRegister } from "./lib/dependencies.ts";
import { checkLintConfigs } from "./lib/lint-configs.ts";
import { checkProtectedDiff } from "./lib/protected-diff.ts";
import { checkTypeScriptConfigs } from "./lib/tsconfig.ts";
import { scanEscapeHatches } from "./lib/escape-hatches.ts";

export { checkDependencyRegister } from "./lib/dependencies.ts";

export { checkLintConfigs } from "./lib/lint-configs.ts";

export { checkProtectedDiff } from "./lib/protected-diff.ts";

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

  const diffBase = process.env.GUARD_DIFF_BASE;

  if (diffBase !== undefined) {
    return [...findings, ...checkProtectedDiff(diffBase)];
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
