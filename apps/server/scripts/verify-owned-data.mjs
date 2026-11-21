/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const server = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "voltonaut-owned-cli-"));

try {
  symlinkSync(join(server, "node_modules"), join(temporary, "node_modules"), "dir");
  await build({
    root: server,
    configFile: join(server, "vite.config.ts"),
    build: {
      ssr: fileURLToPath(new URL("verify-owned-data.ts", import.meta.url)),
      outDir: temporary,
      emptyOutDir: false,
      rolldownOptions: { output: { entryFileNames: "verify-owned-data.mjs" } },
    },
    ssr: { noExternal: ["@voltonaut/engine", "@voltonaut/shared"] },
  });

  const result = spawnSync(
    process.execPath,
    [join(temporary, "verify-owned-data.mjs"), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );

  if (result.error) throw result.error;

  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
