import { readFileSync } from "node:fs";

/** Concrete value shapes the guard reads from tsconfig compilerOptions. */
export type CompilerOptionValue = string | boolean | readonly string[];

export type CompilerOptionsFile = Readonly<Record<string, CompilerOptionValue>>;

export interface TsConfigFile {
  readonly extends?: string;
  readonly compilerOptions?: CompilerOptionsFile;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly files?: readonly string[];
  readonly references?: readonly object[];
}

export interface PackageJsonFile {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/** The concrete shapes the guard compares between a config file and its expected value. */
export type ComparableValue =
  | string
  | boolean
  | number
  | readonly (string | boolean | number)[]
  | CompilerOptionsFile
  | undefined;

/**
 * Repo-controlled config files are trusted to match the declared interface;
 * the guards only establish that the JSON top level is an object.
 */
function isTsConfigObject(value: unknown): value is TsConfigFile {
  return value instanceof Object && !Array.isArray(value);
}

function isPackageJsonObject(value: unknown): value is PackageJsonFile {
  return value instanceof Object && !Array.isArray(value);
}

export function readTsConfigFile(file: string): TsConfigFile {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

  if (isTsConfigObject(parsed)) {
    return parsed;
  }

  throw new Error(`${file}: expected a JSON object at the top level`);
}

export function readPackageJsonFile(file: string): PackageJsonFile {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

  if (isPackageJsonObject(parsed)) {
    return parsed;
  }

  throw new Error(`${file}: expected a JSON object at the top level`);
}

export function equals(actual: ComparableValue, expected: ComparableValue): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
