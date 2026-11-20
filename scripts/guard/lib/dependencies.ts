import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { relative } from "./files.ts";
import { escapeRegExp, readPackageJsonFile } from "./json.ts";

function workspacePackageFiles(root: string): readonly string[] {
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

function registerPattern(name: string): string {
  return `(^|[^A-Za-z0-9_-])${escapeRegExp(name)}([^A-Za-z0-9_-]|$)`;
}

export function checkDependencyRegister(root: string): readonly string[] {
  const findings: string[] = [];
  const register = readFileSync(join(root, "docs", "dependencies.md"), "utf8");
  const dependencies = new Map<string, string>();

  for (const file of workspacePackageFiles(root)) {
    const pkg = readPackageJsonFile(file);

    for (const group of ["dependencies", "devDependencies"] as const) {
      for (const name of Object.keys(pkg[group] ?? {})) {
        dependencies.set(`${name} (${group})`, relative(root, file));
      }
    }
  }

  for (const [key, file] of dependencies) {
    const name = key.slice(0, key.lastIndexOf(" ("));
    const pattern = new RegExp(registerPattern(name), "u");

    if (!pattern.test(register)) {
      findings.push(`${file}: dependency '${name}' is missing from docs/dependencies.md`);
    }
  }

  return findings;
}
