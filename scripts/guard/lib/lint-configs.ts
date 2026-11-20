import { readFileSync } from "node:fs";
import { join } from "node:path";

const antiSlopRules = [
  "anti-slop/no-array-filter-map",
  "anti-slop/no-reduce-accumulator-copy",
  "anti-slop/no-chained-type-assertions",
  "anti-slop/no-conditional-empty-object-spread",
  "anti-slop/no-known-value-widening",
  "anti-slop/no-module-mocking",
  "anti-slop/no-object-parameters",
  "anti-slop/no-reflect-apply",
  "anti-slop/no-reflect-get",
  "anti-slop/no-runtime-typeof",
  "anti-slop/no-shape-in-symbol-names",
  "anti-slop/no-unknown-parameters",
  "anti-slop/no-unknown-returns",
  "anti-slop/no-unknown-type-aliases",
  "anti-slop/no-unsafe-dictionary-type",
  "anti-slop/no-widen-then-assert",
  "anti-slop/require-readable-spacing",
  "anti-slop/require-safety-comment-for-type-assertion",
];

const requiredLintRules = [
  "oxc/no-accumulating-spread",
  "typescript/no-explicit-any",
  "typescript/no-non-null-assertion",
  "typescript/no-floating-promises",
  "typescript/no-misused-promises",
  "typescript/no-unsafe-assignment",
  "typescript/no-unsafe-member-access",
  "typescript/strict-boolean-expressions",
  "typescript/switch-exhaustiveness-check",
  "typescript/consistent-type-imports",
  "typescript/ban-ts-comment",
  "no-console",
  "import/no-cycle",
  "import/no-default-export",
];

// The dependency-cruiser rules are grouped by prefix (e.g. "engine-pure-core"), so each pattern matches the whole family.
const requiredRulePatterns: readonly [RegExp, string][] = [
  [/name: "no-cross-app"/u, "no-cross-app"],
  [/name: "packages-not-to-apps"/u, "packages-not-to-apps"],
  [/name: "shared-is-leaf-/u, "shared-is-leaf"],
  [/name: "engine-pure-/u, "engine-pure"],
  [/name: "rules-pure-/u, "rules-pure"],
  [/name: "ble-isolated-/u, "ble-isolated"],
  [/name: "engine-internal-private"/u, "engine-internal-private"],
  [/name: "web-layers-/u, "web-layers"],
  [/name: "three-only-in-render"/u, "three-only-in-render"],
  [/name: "server-no-browser"/u, "server-no-browser"],
  [/name: "no-circular"/u, "no-circular"],
  [/name: "no-orphans"/u, "no-orphans"],
  [/name: "not-to-dev-dep"/u, "not-to-dev-dep"],
  [/name: "not-to-unresolvable"/u, "not-to-unresolvable"],
];

function loosenedLineFindings(relativePath: string, text: string): string[] {
  const findings: string[] = [];
  const lines = text.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    const hasWarn =
      /:\s*"(warn|off)"\s*,?/u.test(line) ||
      /:\s*'(warn|off)'\s*,?/u.test(line) ||
      /severity:\s*["'](warn|off)["']/u.test(line);

    if (!hasWarn) {
      continue;
    }

    const isDocumentedOverride =
      relativePath === "oxlint.config.ts" && line.includes('"import/no-default-export"');

    if (!isDocumentedOverride) {
      findings.push(`${relativePath}:${index + 1}: rule severity is loosened to warn or off`);
    }
  }

  return findings;
}

function missingOxlintRuleFindings(oxlint: string): string[] {
  const findings: string[] = [];

  if (!oxlint.includes("typeAware: true") || !oxlint.includes("denyWarnings: true")) {
    findings.push("oxlint.config.ts: type-aware linting and denied warnings are mandatory");
  }

  for (const rule of [...antiSlopRules, ...requiredLintRules]) {
    if (!oxlint.includes(`"${rule}"`)) {
      findings.push(`oxlint.config.ts: required rule '${rule}' is missing`);
    }
  }

  return findings;
}

function missingDepcruiseRuleFindings(depcruise: string): string[] {
  const findings: string[] = [];

  for (const [pattern, rule] of requiredRulePatterns) {
    if (!pattern.test(depcruise)) {
      findings.push(`.dependency-cruiser.cjs: required rule '${rule}' is missing`);
    }
  }

  return findings;
}

export function checkLintConfigs(root: string): readonly string[] {
  const oxlint = readFileSync(join(root, "oxlint.config.ts"), "utf8");
  const depcruise = readFileSync(join(root, ".dependency-cruiser.cjs"), "utf8");

  return [
    ...loosenedLineFindings("oxlint.config.ts", oxlint),
    ...missingOxlintRuleFindings(oxlint),
    ...loosenedLineFindings(".dependency-cruiser.cjs", depcruise),
    ...missingDepcruiseRuleFindings(depcruise),
  ];
}
