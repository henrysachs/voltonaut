import { parseServerConfig } from "./config.js";

/**
 * `node dist/main.js check-config`: validates this build's configuration from the environment
 * without opening ports, files or the database. deploy.sh runs it in a one-off container before
 * the running release is replaced.
 */
export function checkConfigMain(args: readonly string[]): void {
  if (args.length > 0) throw new Error("usage: node dist/main.js check-config");

  try {
    parseServerConfig(process.env, process.env["NODE_ENV"] ?? "development");
  } catch {
    // Parser messages may echo configuration values; only report the outcome.
    process.stderr.write("config: invalid\n");
    process.exitCode = 1;

    return;
  }

  process.stdout.write("config: ok\n");
}
