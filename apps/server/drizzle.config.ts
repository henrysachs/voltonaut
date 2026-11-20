/**
 * drizzle-kit configuration. drizzle-kit loads this file and accepts a plain
 * default export; `defineConfig` from drizzle-kit is intentionally not imported
 * because drizzle-kit is a devDependency (depcruise `not-to-dev-dep`).
 *
 * Run `pnpm --filter @voltonaut/server db:generate` to write SQL migrations
 * into ./drizzle after changing a module schema file.
 */
export default {
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
};
