#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const expectedBaseCompilerOptions = {
  target: "ES2023",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noPropertyAccessFromIndexSignature: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  allowUnreachableCode: false,
  allowUnusedLabels: false,
  useUnknownInCatchVariables: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  forceConsistentCasingInFileNames: true,
  skipLibCheck: false,
  composite: true,
  declaration: true,
  sourceMap: true,
};

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

const ignoredDirectories = new Set([
  ".git",
  ".audit",
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  ".stryker-tmp",
]);

const guardSelfFiles = new Set([
  join("oxlint.config.ts"),
  join("scripts", "guard.mjs"),
  join("scripts", "guard.test.mjs"),
]);

function collectFiles(root, directory = root, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      if (entryPath === join(root, "tools", "oxlint", "anti-slop")) {
        continue;
      }

      collectFiles(root, entryPath, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function relative(root, file) {
  return file.slice(root.length + 1);
}

function lineByLine(text, onLine) {
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    onLine(line, index + 1);
  }
}

export function scanEscapeHatches(root) {
  const findings = [];

  const files = collectFiles(root).filter((file) => {
    const relativePath = relative(root, file);

    if (guardSelfFiles.has(relativePath)) {
      return false;
    }

    const extension = relativePath.slice(relativePath.lastIndexOf("."));

    return sourceExtensions.has(extension);
  });

  for (const file of files) {
    const relativePath = relative(root, file);
    const text = readFileSync(file, "utf8");
    lineByLine(text, (line, lineNumber) => {
      const direct = [
        { pattern: /@ts-ignore/u, message: "@ts-ignore is forbidden" },
        { pattern: /@ts-nocheck/u, message: "@ts-nocheck is forbidden" },
        { pattern: /eslint-disable/u, message: "eslint-disable is forbidden" },
        { pattern: /\bas\s+any\b/u, message: "'as any' is forbidden" },
        { pattern: /\bas\s+unknown\s+as\b/u, message: "'as unknown as' is forbidden" },
        { pattern: /(?<![!=])!(?=[.([])/u, message: "non-null assertion is forbidden" },
      ];

      for (const { pattern, message } of direct) {
        if (pattern.test(line)) {
          findings.push({ file: relativePath, line: lineNumber, message });
        }
      }

      if (/@ts-expect-error/u.test(line) && !/@ts-expect-error\s+\S/u.test(line)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          message: "@ts-expect-error needs a description",
        });
      }

      if (/oxlint-disable(?:-next-line|-line)?/u.test(line) && !/--\s+\S/u.test(line)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          message: "oxlint-disable needs a '-- reason' comment",
        });
      }
    });
  }

  return findings;
}

function jsonRead(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function equals(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function compilerOptionFindings(relativePath, compilerOptions) {
  const findings = [];

  const allowedKeys = new Set([
    "lib",
    "types",
    "module",
    "moduleResolution",
    "rootDir",
    "outDir",
    "experimentalDecorators",
    "emitDecoratorMetadata",
  ]);

  for (const key of Object.keys(compilerOptions)) {
    if (!allowedKeys.has(key)) {
      findings.push(`${relativePath}: compiler option '${key}' is not an allowed override`);
    }
  }

  if (relativePath === "tsconfig.json") {
    const rootAllowed = new Set(["types", "rootDir", "outDir"]);

    for (const key of Object.keys(compilerOptions)) {
      if (!rootAllowed.has(key)) {
        findings.push(
          `${relativePath}: compiler option '${key}' is not allowed in the root config`,
        );
      }
    }

    if (!equals(compilerOptions.types, ["node"])) {
      findings.push(`${relativePath}: root types must be exactly ["node"]`);
    }

    return findings;
  }

  const pureLib = ["ES2023"];
  const browserLib = ["ES2023", "DOM", "DOM.Iterable"];

  const isTestConfig = relativePath.endsWith('tsconfig.test.json');

  if (/^packages\/(shared|engine|rules)\/tsconfig.*\.json$/u.test(relativePath)) {
    if (isTestConfig) {
      if (!equals(compilerOptions.lib, browserLib)) {
        findings.push(
          `${relativePath}: test lib must be exactly ["ES2023", "DOM", "DOM.Iterable"]`,
        );
      }

      if (!equals(compilerOptions.types, ["node"])) {
        findings.push(`${relativePath}: test types must be exactly ["node"]`);
      }
    } else {
      if (!equals(compilerOptions.lib, pureLib)) {
        findings.push(`${relativePath}: lib must be exactly ["ES2023"]`);
      }

      if ("types" in compilerOptions && !equals(compilerOptions.types, [])) {
        findings.push(`${relativePath}: types must be exactly []`);
      }
    }

    if ("module" in compilerOptions || "moduleResolution" in compilerOptions) {
      findings.push(`${relativePath}: module settings cannot deviate from the base config`);
    }

    if ("experimentalDecorators" in compilerOptions || "emitDecoratorMetadata" in compilerOptions) {
      findings.push(`${relativePath}: decorator options are not allowed in pure packages`);
    }
  }

  if (/^packages\/ble\/tsconfig.*\.json$/u.test(relativePath)) {
    if (!equals(compilerOptions.lib, browserLib)) {
      findings.push(`${relativePath}: lib must be exactly ["ES2023", "DOM", "DOM.Iterable"]`);
    }

    if (isTestConfig) {
      if (!equals(compilerOptions.types, ["node"])) {
        findings.push(`${relativePath}: test types must be exactly ["node"]`);
      }
    } else if ("types" in compilerOptions && !equals(compilerOptions.types, [])) {
      findings.push(`${relativePath}: types must be exactly []`);
    }

    if ("module" in compilerOptions || "moduleResolution" in compilerOptions) {
      findings.push(`${relativePath}: module settings cannot deviate from the base config`);
    }
  }

  if (/^apps\/web\/tsconfig.*\.json$/u.test(relativePath)) {
    if (compilerOptions.module !== "ESNext" || compilerOptions.moduleResolution !== "Bundler") {
      findings.push(`${relativePath}: web must use module ESNext and moduleResolution Bundler`);
    }

    if (!equals(compilerOptions.lib, browserLib)) {
      findings.push(`${relativePath}: web lib must include ES2023, DOM, and DOM.Iterable`);
    }

    if (!equals(compilerOptions.types, ["node"])) {
      findings.push(`${relativePath}: web types must be exactly ["node"]`);
    }

    if ("experimentalDecorators" in compilerOptions || "emitDecoratorMetadata" in compilerOptions) {
      findings.push(`${relativePath}: decorator options are not allowed in apps/web`);
    }
  }

  if (/^apps\/server\/tsconfig.*\.json$/u.test(relativePath)) {
    if (!equals(compilerOptions.lib, pureLib)) {
      findings.push(`${relativePath}: server lib must be exactly ["ES2023"]`);
    }

    if (!equals(compilerOptions.types, ["node"])) {
      findings.push(`${relativePath}: server types must be exactly ["node"]`);
    }

    if (
      compilerOptions.experimentalDecorators !== true ||
      compilerOptions.emitDecoratorMetadata !== true
    ) {
      findings.push(
        `${relativePath}: server needs experimentalDecorators and emitDecoratorMetadata`,
      );
    }

    if ("module" in compilerOptions || "moduleResolution" in compilerOptions) {
      findings.push(`${relativePath}: server module settings cannot deviate from the base config`);
    }
  }

  return findings;
}

export function checkTypeScriptConfigs(root) {
  const findings = [];
  const configs = collectFiles(root).filter((file) => /tsconfig.*\.json$/u.test(file));

  for (const file of configs) {
    const relativePath = relative(root, file);
    let config;

    try {
      config = jsonRead(file);
    } catch (error) {
      findings.push(`${relativePath}: invalid JSON (${error.message})`);
      continue;
    }

    if (relativePath === "tsconfig.base.json") {
      if (!equals(config.compilerOptions, expectedBaseCompilerOptions)) {
        findings.push(
          `${relativePath}: base compilerOptions deviate from docs/09-tooling.md section 4`,
        );
      }

      continue;
    }

    if (config.extends === undefined) {
      findings.push(`${relativePath}: every project config must extend tsconfig.base.json`);
      continue;
    }

    const allowedTopLevel = new Set([
      "extends",
      "compilerOptions",
      "include",
      "exclude",
      "files",
      "references",
    ]);

    for (const key of Object.keys(config)) {
      if (!allowedTopLevel.has(key)) {
        findings.push(`${relativePath}: top-level key '${key}' is not allowed`);
      }
    }

    const isTestConfig = relativePath.endsWith('tsconfig.test.json');

    if (!isTestConfig && relativePath.startsWith('packages/')) {
      if (!(config.exclude ?? []).includes("src/**/*.test.ts")) {
        findings.push(`${relativePath}: production config must exclude src/**/*.test.ts`);
      }
    }

    findings.push(...compilerOptionFindings(relativePath, config.compilerOptions ?? {}));
  }

  return findings;
}

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

function loosenedLineFindings(relativePath, text) {
  const findings = [];
  lineByLine(text, (line, lineNumber) => {
    const hasWarn = /:\s*"(warn|off)"\s*,?/u.test(line) || /severity:\s*"(warn|off)"/u.test(line);

    if (!hasWarn) {
      return;
    }

    if (relativePath === "oxlint.config.ts" && line.includes('"import/no-default-export"')) {
      return;
    }

    findings.push(`${relativePath}:${lineNumber}: rule severity is loosened to warn or off`);
  });

  return findings;
}

export function checkLintConfigs(root) {
  const findings = [];
  const oxlintPath = join(root, "oxlint.config.ts");
  const oxlint = readFileSync(oxlintPath, "utf8");
  findings.push(...loosenedLineFindings("oxlint.config.ts", oxlint));

  if (!oxlint.includes("typeAware: true") || !oxlint.includes("denyWarnings: true")) {
    findings.push("oxlint.config.ts: type-aware linting and denied warnings are mandatory");
  }

  for (const rule of [...antiSlopRules, ...requiredLintRules]) {
    if (!oxlint.includes(`"${rule}"`)) {
      findings.push(`oxlint.config.ts: required rule '${rule}' is missing`);
    }
  }

  const depcruisePath = join(root, ".dependency-cruiser.cjs");
  const depcruise = readFileSync(depcruisePath, "utf8");
  findings.push(...loosenedLineFindings(".dependency-cruiser.cjs", depcruise));

  const requiredRulePatterns = [
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

  for (const [pattern, rule] of requiredRulePatterns) {
    if (!pattern.test(depcruise)) {
      findings.push(`.dependency-cruiser.cjs: required rule '${rule}' is missing`);
    }
  }

  return findings;
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function workspacePackageFiles(root) {
  const files = [join(root, "package.json")];

  for (const group of ["apps", "packages"]) {
    const groupPath = join(root, group);

    for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        files.push(join(groupPath, entry.name, "package.json"));
      }
    }
  }

  return files;
}

export function checkDependencyRegister(root) {
  const findings = [];
  const register = readFileSync(join(root, "docs", "dependencies.md"), "utf8");
  const dependencies = new Map();

  for (const file of workspacePackageFiles(root)) {
    const pkg = jsonRead(file);

    const groups = [
      ["dependencies", pkg.dependencies],
      ["devDependencies", pkg.devDependencies],
    ];

    for (const [group, entries] of groups) {
      for (const name of Object.keys(entries ?? {})) {
        const key = `${name} (${group})`;
        dependencies.set(key, relative(root, file));
      }
    }
  }

  for (const [key, file] of dependencies) {
    const name = key.slice(0, key.lastIndexOf(" ("));
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(name)}([^A-Za-z0-9_-]|$)`, "u");

    if (!pattern.test(register)) {
      findings.push(`${file}: dependency '${name}' is missing from docs/dependencies.md`);
    }
  }

  return findings;
}

const protectedPatterns = [
  /^mise\.toml$/u,
  /^tsconfig.*\.json$/u,
  /^oxlint\.config\.ts$/u,
  /^tools\/oxlint\//u,
  /^\.oxfmtrc\.json$/u,
  /^\.dependency-cruiser\.cjs$/u,
  /^scripts\/guard\.mjs$/u,
  /^\.github\//u,
  /^pnpm-workspace\.yaml$/u,
  /^docs\/decisions\//u,
  /^fixtures\//u,
  /^apps\/web\/e2e\/__screenshots__\//u,
];

export function checkProtectedDiff(base) {
  if (process.env.GUARD_ALLOW_PROTECTED === "baseline-update") {
    return [];
  }

  const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });

  const changed = output.split(/\r?\n/).filter((line) => line.length > 0);
  const adrChanged = changed.some((file) => file.startsWith('docs/decisions/ADR-'));

  if (adrChanged) {
    return [];
  }

  return changed
    .filter((file) => protectedPatterns.some((pattern) => pattern.test(file)))
    .map((file) => `${file}: protected file changed without an ADR in the same diff`);
}

export async function runGuard(root = process.cwd()) {
  const findings = [
    ...scanEscapeHatches(root),
    ...checkTypeScriptConfigs(root),
    ...checkLintConfigs(root),
    ...checkDependencyRegister(root),
  ];

  const diffBase = process.env.GUARD_DIFF_BASE;

  if (diffBase !== undefined) {
    findings.push(...checkProtectedDiff(diffBase));
  }

  return findings;
}

async function main() {
  const findings = await runGuard();

  for (const finding of findings) {
    console.error(`guard: ${finding}`);
  }

  if (findings.length > 0) {
    process.exitCode = 1;

    return;
  }

  console.log("guard: no escape hatches, no loosened configs, all dependencies registered");
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  await main();
}
