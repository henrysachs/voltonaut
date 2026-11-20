import { collectFiles, relative } from "./files.ts";
import { type CompilerOptionsFile, type TsConfigFile, equals, readTsConfigFile } from "./json.ts";

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

const allowedOverrideKeys = new Set([
  "lib",
  "types",
  "module",
  "moduleResolution",
  "rootDir",
  "outDir",
  "experimentalDecorators",
  "emitDecoratorMetadata",
]);

const allowedTopLevelKeys = new Set([
  "extends",
  "compilerOptions",
  "include",
  "exclude",
  "files",
  "references",
]);

const pureLib = ["ES2023"];
const browserLib = ["ES2023", "DOM", "DOM.Iterable"];

function allowedKeyFindings(relativePath: string, compilerOptions: CompilerOptionsFile): string[] {
  const findings: string[] = [];

  for (const key of Object.keys(compilerOptions)) {
    if (!allowedOverrideKeys.has(key)) {
      findings.push(`${relativePath}: compiler option '${key}' is not an allowed override`);
    }
  }

  return findings;
}

function moduleDeviationFindings(
  relativePath: string,
  compilerOptions: CompilerOptionsFile,
): string[] {
  if ("module" in compilerOptions || "moduleResolution" in compilerOptions) {
    return [`${relativePath}: module settings cannot deviate from the base config`];
  }

  return [];
}

function rootConfigFindings(relativePath: string, compilerOptions: CompilerOptionsFile): string[] {
  const findings = allowedKeyFindings(relativePath, compilerOptions);
  const rootAllowed = new Set(["types", "rootDir", "outDir"]);

  for (const key of Object.keys(compilerOptions)) {
    if (!rootAllowed.has(key)) {
      findings.push(`${relativePath}: compiler option '${key}' is not allowed in the root config`);
    }
  }

  if (!equals(compilerOptions["types"], ["node"])) {
    findings.push(`${relativePath}: root types must be exactly ["node"]`);
  }

  return findings;
}

function purePackageFindings(relativePath: string, compilerOptions: CompilerOptionsFile): string[] {
  const findings: string[] = [];
  const isTestConfig = relativePath.endsWith("tsconfig.test.json");

  if (isTestConfig) {
    if (!equals(compilerOptions["lib"], browserLib)) {
      findings.push(`${relativePath}: test lib must be exactly ["ES2023", "DOM", "DOM.Iterable"]`);
    }

    if (!equals(compilerOptions["types"], ["node"])) {
      findings.push(`${relativePath}: test types must be exactly ["node"]`);
    }
  } else {
    if (!equals(compilerOptions["lib"], pureLib)) {
      findings.push(`${relativePath}: lib must be exactly ["ES2023"]`);
    }

    if ("types" in compilerOptions && !equals(compilerOptions["types"], [])) {
      findings.push(`${relativePath}: types must be exactly []`);
    }
  }

  findings.push(...moduleDeviationFindings(relativePath, compilerOptions));

  if ("experimentalDecorators" in compilerOptions || "emitDecoratorMetadata" in compilerOptions) {
    findings.push(`${relativePath}: decorator options are not allowed in pure packages`);
  }

  return findings;
}

function bleFindings(relativePath: string, compilerOptions: CompilerOptionsFile): string[] {
  const findings: string[] = [];
  const isTestConfig = relativePath.endsWith("tsconfig.test.json");

  if (!equals(compilerOptions["lib"], browserLib)) {
    findings.push(`${relativePath}: lib must be exactly ["ES2023", "DOM", "DOM.Iterable"]`);
  }

  if (isTestConfig) {
    if (!equals(compilerOptions["types"], ["node"])) {
      findings.push(`${relativePath}: test types must be exactly ["node"]`);
    }
  } else if ("types" in compilerOptions && !equals(compilerOptions["types"], [])) {
    findings.push(`${relativePath}: types must be exactly []`);
  }

  findings.push(...moduleDeviationFindings(relativePath, compilerOptions));

  return findings;
}

function webFindings(relativePath: string, compilerOptions: CompilerOptionsFile): string[] {
  const findings: string[] = [];

  if (compilerOptions["module"] !== "ESNext" || compilerOptions["moduleResolution"] !== "Bundler") {
    findings.push(`${relativePath}: web must use module ESNext and moduleResolution Bundler`);
  }

  if (!equals(compilerOptions["lib"], browserLib)) {
    findings.push(`${relativePath}: web lib must include ES2023, DOM, and DOM.Iterable`);
  }

  if (!equals(compilerOptions["types"], ["node"])) {
    findings.push(`${relativePath}: web types must be exactly ["node"]`);
  }

  if ("experimentalDecorators" in compilerOptions || "emitDecoratorMetadata" in compilerOptions) {
    findings.push(`${relativePath}: decorator options are not allowed in apps/web`);
  }

  return findings;
}

function serverFindings(relativePath: string, compilerOptions: CompilerOptionsFile): string[] {
  const findings: string[] = [];

  if (!equals(compilerOptions["lib"], pureLib)) {
    findings.push(`${relativePath}: server lib must be exactly ["ES2023"]`);
  }

  if (!equals(compilerOptions["types"], ["node"])) {
    findings.push(`${relativePath}: server types must be exactly ["node"]`);
  }

  if (
    compilerOptions["experimentalDecorators"] !== true ||
    compilerOptions["emitDecoratorMetadata"] !== true
  ) {
    findings.push(`${relativePath}: server needs experimentalDecorators and emitDecoratorMetadata`);
  }

  findings.push(...moduleDeviationFindings(relativePath, compilerOptions));

  return findings;
}

function compilerOptionFindings(relativePath: string, config: TsConfigFile): readonly string[] {
  const compilerOptions = config.compilerOptions ?? {};
  const findings = allowedKeyFindings(relativePath, compilerOptions);

  if (relativePath === "tsconfig.json") {
    return [...findings, ...rootConfigFindings(relativePath, compilerOptions)];
  }

  if (/^packages\/(shared|engine|rules)\/tsconfig.*\.json$/u.test(relativePath)) {
    return [...findings, ...purePackageFindings(relativePath, compilerOptions)];
  }

  if (/^packages\/ble\/tsconfig.*\.json$/u.test(relativePath)) {
    return [...findings, ...bleFindings(relativePath, compilerOptions)];
  }

  if (/^apps\/web\/tsconfig.*\.json$/u.test(relativePath)) {
    return [...findings, ...webFindings(relativePath, compilerOptions)];
  }

  if (/^apps\/server\/tsconfig.*\.json$/u.test(relativePath)) {
    return [...findings, ...serverFindings(relativePath, compilerOptions)];
  }

  return findings;
}

function topLevelFindings(relativePath: string, config: TsConfigFile): string[] {
  const findings: string[] = [];

  for (const key of Object.keys(config)) {
    if (!allowedTopLevelKeys.has(key)) {
      findings.push(`${relativePath}: top-level key '${key}' is not allowed`);
    }
  }

  const isPackageConfig =
    !relativePath.endsWith("tsconfig.test.json") && relativePath.startsWith("packages/");

  const excludedTests = (config.exclude ?? []).includes("src/**/*.test.ts");

  if (isPackageConfig && !excludedTests) {
    findings.push(`${relativePath}: production config must exclude src/**/*.test.ts`);
  }

  return findings;
}

export function checkTypeScriptConfigs(root: string): readonly string[] {
  const findings: string[] = [];
  const configs = collectFiles(root).filter((file) => /tsconfig.*\.json$/u.test(file));

  for (const file of configs) {
    const relativePath = relative(root, file);

    let config: TsConfigFile;

    try {
      config = readTsConfigFile(file);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      findings.push(`${relativePath}: invalid JSON (${reason})`);
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

    findings.push(
      ...topLevelFindings(relativePath, config),
      ...compilerOptionFindings(relativePath, config),
    );
  }

  return findings;
}
