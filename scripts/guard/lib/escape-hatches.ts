import { readFileSync } from "node:fs";

import { collectFiles, relative } from "./files.ts";

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

/** The guard's own sources embed the escape-hatch patterns as literals; scanning them would self-report. */
const guardSelfPattern = /^scripts\/guard(\.|$|\/)/u;
const oxlintConfigPath = "oxlint.config.ts";

/** Docs/09-tooling.md section 7: `as any` / `as unknown as` are only forbidden outside test and BLE parse files. */
const assertionExceptionPattern = /(^|\/)[^/]*\.test\.tsx?$/u;
const parseFilePattern = /^packages\/ble\/src\/.*parse.*\.tsx?$/u;

interface EscapeHatchFinding {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

interface HatchPattern {
  readonly pattern: Readonly<RegExp>;
  readonly message: string;
}

const directEscapeHatches: readonly HatchPattern[] = [
  { pattern: /@ts-ignore/u, message: "@ts-ignore is forbidden" },
  { pattern: /@ts-nocheck/u, message: "@ts-nocheck is forbidden" },
  { pattern: /eslint-disable/u, message: "eslint-disable is forbidden" },
];

const assertionEscapeHatches: readonly HatchPattern[] = [
  { pattern: /\bas\s+any\b/u, message: "'as any' is forbidden" },
  { pattern: /\bas\s+unknown\s+as\b/u, message: "'as unknown as' is forbidden" },
];

function isGuardSource(relativePath: string): boolean {
  return guardSelfPattern.test(relativePath) || relativePath === oxlintConfigPath;
}

function allowsBareAssertions(
  relativePath: string,
  lines: readonly string[],
  index: number,
): boolean {
  if (assertionExceptionPattern.test(relativePath)) {
    return true;
  }

  if (!parseFilePattern.test(relativePath)) {
    return false;
  }

  const line = lines[index] ?? "";
  const previousLine = index > 0 ? (lines[index - 1] ?? "") : "";

  return line.includes("//") || previousLine.includes("//");
}

function hatchFindings(
  relativePath: string,
  lineNumber: number,
  line: string,
  hatches: readonly HatchPattern[],
  allowed: boolean,
): readonly EscapeHatchFinding[] {
  const findings: EscapeHatchFinding[] = [];

  for (const { pattern, message } of hatches) {
    if (pattern.test(line) && !allowed) {
      findings.push({ file: relativePath, line: lineNumber, message });
    }
  }

  return findings;
}

function directiveDescriptionFindings(
  relativePath: string,
  lineNumber: number,
  line: string,
): readonly EscapeHatchFinding[] {
  const findings: EscapeHatchFinding[] = [];

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

  return findings;
}

export function scanEscapeHatches(root: string): readonly EscapeHatchFinding[] {
  const findings: EscapeHatchFinding[] = [];

  const files = collectFiles(root).filter((file) => {
    const relativePath = relative(root, file);

    if (isGuardSource(relativePath)) {
      return false;
    }

    return sourceExtensions.has(relativePath.slice(relativePath.lastIndexOf(".")));
  });

  for (const file of files) {
    const relativePath = relative(root, file);
    const lines = readFileSync(file, "utf8").split(/\r?\n/u);

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;

      findings.push(
        ...hatchFindings(relativePath, lineNumber, line, directEscapeHatches, false),
        ...hatchFindings(
          relativePath,
          lineNumber,
          line,
          assertionEscapeHatches,
          allowsBareAssertions(relativePath, lines, index),
        ),
        ...directiveDescriptionFindings(relativePath, lineNumber, line),
      );
    }
  }

  return findings;
}
