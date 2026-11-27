import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  checkDependencyRegister,
  checkLintConfigs,
  checkTypeScriptConfigs,
  expectedBaseCompilerOptions,
  scanEscapeHatches,
} from "./main.ts";
import { withTempDir } from "./temp-dir.ts";

await test("scanEscapeHatches rejects every documented escape hatch", () => {
  withTempDir((root) => {
    writeFileSync(
      join(root, "bad.ts"),
      [
        "// @ts-ignore",
        "const value = input as any;",
        "const second = input as unknown as string;",
        "// oxlint-disable-next-line",
        "// @ts-expect-error",
        "export const values = 1;",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "good.ts"),
      [
        "// SAFETY: schema parsed this value before the assertion",
        "export const good = 1;",
        "",
      ].join("\n"),
    );

    const findings = scanEscapeHatches(root);
    assert.equal(findings.length, 5);
    const [first] = findings;
    assert.ok(first !== undefined);
    assert.equal(first.file, "bad.ts");
    assert.equal(first.line, 1);
    assert.ok(findings.some((finding) => finding.message.includes("as any")));
    assert.ok(findings.some((finding) => finding.message.includes("as unknown as")));
    assert.ok(findings.some((finding) => finding.message.includes("oxlint-disable")));
    assert.ok(findings.some((finding) => finding.message.includes("@ts-expect-error")));
  });
});

await test("scanEscapeHatches leaves negation to the AST: '!(x instanceof Y)' is no finding (5d00ee7)", () => {
  withTempDir((root) => {
    writeFileSync(
      join(root, "negation.ts"),
      [
        "export function isPlain(value: Date | string): boolean {",
        "  return !(value instanceof Date) && ![value].includes('');",
        "}",
        "",
      ].join("\n"),
    );

    assert.deepEqual(scanEscapeHatches(root), []);
  });
});

await test("checkLintConfigs keeps the AST non-null rule that replaced the guard regex (ADR-036)", () => {
  withTempDir((root) => {
    const oxlintConfig = [
      "export default defineConfig({",
      "  options: { typeAware: true, denyWarnings: true },",
      '  rules: { "typescript/no-non-null-assertion": "error" },',
      "});",
      "",
    ].join("\n");

    writeFileSync(join(root, "oxlint.config.ts"), oxlintConfig);
    writeFileSync(join(root, ".dependency-cruiser.cjs"), "module.exports = {};\n");

    const missing = "required rule 'typescript/no-non-null-assertion' is missing";
    assert.ok(!checkLintConfigs(root).some((finding) => finding.includes(missing)));

    writeFileSync(
      join(root, "oxlint.config.ts"),
      oxlintConfig.replace('"typescript/no-non-null-assertion": "error"', ""),
    );
    assert.ok(checkLintConfigs(root).some((finding) => finding.includes(missing)));
  });
});

function writeStrictConfigs(root: string): void {
  writeFileSync(
    join(root, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: expectedBaseCompilerOptions }, null, 2),
  );
  mkdirSync(join(root, "packages", "shared"), { recursive: true });
  writeFileSync(
    join(root, "packages", "shared", "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { lib: ["ES2023"], types: [], rootDir: "src", outDir: "dist" },
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts"],
      },
      null,
      2,
    ),
  );
  mkdirSync(join(root, "apps", "server"), { recursive: true });
  writeFileSync(
    join(root, "apps", "server", "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          lib: ["ES2023"],
          types: ["node"],
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          skipLibCheck: true,
          rootDir: "src",
          outDir: "dist",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
}

await test("checkTypeScriptConfigs accepts pure and server configs and rejects loosening", () => {
  withTempDir((root) => {
    writeStrictConfigs(root);
    assert.deepEqual(checkTypeScriptConfigs(root), []);

    mkdirSync(join(root, "packages", "engine"), { recursive: true });
    writeFileSync(
      join(root, "packages", "engine", "tsconfig.json"),
      JSON.stringify(
        {
          extends: "../../tsconfig.base.json",
          compilerOptions: { strict: false, lib: ["ES2023", "DOM"] },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
    );

    const findings = checkTypeScriptConfigs(root);
    assert.ok(findings.some((finding) => finding.includes("'strict' is not an allowed override")));
    assert.ok(findings.some((finding) => finding.includes("lib must be exactly")));
  });
});

const nonServerConfigs = [
  "tsconfig.json",
  "packages/shared/tsconfig.json",
  "packages/engine/tsconfig.json",
  "packages/rules/tsconfig.json",
  "packages/ble/tsconfig.json",
  "apps/web/tsconfig.json",
];

await test("skipLibCheck exception cannot spread beyond server", () => {
  withTempDir((root) => {
    writeStrictConfigs(root);

    for (const path of nonServerConfigs) {
      const directory = join(root, path, "..");
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          extends: "../../tsconfig.base.json",
          compilerOptions: { skipLibCheck: true },
          exclude: ["src/**/*.test.ts"],
        }),
      );
    }

    const findings = checkTypeScriptConfigs(root);

    for (const path of nonServerConfigs) {
      const pathFindings = findings.filter((finding) => finding.startsWith(path));

      assert.ok(
        pathFindings.some((finding) =>
          finding.includes("'skipLibCheck' is not an allowed override"),
        ),
      );
    }
  });
});

await test("server library exception does not weaken application strictness", () => {
  withTempDir((root) => {
    writeStrictConfigs(root);
    writeFileSync(
      join(root, "apps", "server", "tsconfig.json"),
      JSON.stringify({
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          lib: ["ES2023"],
          types: ["node"],
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          skipLibCheck: true,
          strict: false,
        },
      }),
    );

    const findings = checkTypeScriptConfigs(root).filter((finding) =>
      finding.startsWith("apps/server/"),
    );

    assert.ok(findings.some((finding) => finding.includes("'strict' is not an allowed override")));
  });
});

await test("root base retains skipLibCheck false", () => {
  withTempDir((root) => {
    writeStrictConfigs(root);
    writeFileSync(
      join(root, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { ...expectedBaseCompilerOptions, skipLibCheck: true } }),
    );
    assert.ok(
      checkTypeScriptConfigs(root).some((finding) =>
        finding.startsWith("tsconfig.base.json: base compilerOptions deviate"),
      ),
    );
  });
});

await test("checkLintConfigs rejects warn and off outside the documented config-file override", () => {
  withTempDir((root) => {
    const oxlintConfig = [
      "export default defineConfig({",
      "  options: { typeAware: true, denyWarnings: true },",
      "  rules: {",
      '    "anti-slop/no-array-filter-map": "error",',
      '    "import/no-default-export": "off",',
      "  },",
      "});",
      "",
    ].join("\n");

    const depcruiseConfig = [
      "module.exports = {",
      "  forbidden: [{ name: 'no-cross-app', severity: 'error' }],",
      "};",
      "",
    ].join("\n");

    writeFileSync(join(root, "oxlint.config.ts"), oxlintConfig);
    writeFileSync(join(root, ".dependency-cruiser.cjs"), depcruiseConfig);

    const allowed = checkLintConfigs(root);
    assert.ok(allowed.every((finding) => finding.includes("required rule")));

    writeFileSync(
      join(root, ".dependency-cruiser.cjs"),
      depcruiseConfig.replace("severity: 'error'", "severity: 'warn'"),
    );
    const findings = checkLintConfigs(root);
    assert.ok(findings.some((finding) => finding.includes("severity is loosened to warn or off")));
  });
});

await test("checkDependencyRegister reports a dependency missing from docs/dependencies.md", () => {
  withTempDir((root) => {
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    mkdirSync(join(root, "packages"), { recursive: true });
    writeFileSync(
      join(root, "apps", "web", "package.json"),
      JSON.stringify({ dependencies: { zod: "4.6.7" } }),
    );
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { oxlint: "1.78.0" } }),
    );
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "dependencies.md"), "| oxlint | root | lint |\n");

    const findings = checkDependencyRegister(root);
    assert.deepEqual(findings, [
      "apps/web/package.json: dependency 'zod' is missing from docs/dependencies.md",
    ]);
  });
});
