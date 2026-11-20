import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard.js";
import { ErrorEnvelopeFilter } from "./filters/error-envelope.filter.js";

export const APP_PROVIDERS = [
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
];
