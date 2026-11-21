/// <reference types="node" />
import { registerHooks } from "node:module";

const fixtures = new URL("../../apps/server/src/testing/", import.meta.url).href;

registerHooks({
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node supplies its native module resolver context.
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(fixtures) === true && specifier.endsWith(".spec.js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }

    return nextResolve(specifier, context);
  },
});

if (process.argv[2] === "--case") await import("./run.mjs");
else {
  const { runSuite } = await import("./suite.mjs");

  await runSuite(process.argv[2]);
}
