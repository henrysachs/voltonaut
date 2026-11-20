// Intentional negative fixture for scripts/test-depcruise.mjs.
// The import below must stay forbidden by the no-cross-app rule.
import "../../apps/server/src/main.js";

export const forbiddenCrossAppImport = true;
