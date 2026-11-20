import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { ServerConfigModule } from "./config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ErrorEnvelopeFilter } from "./filters/error-envelope.filter.js";

import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [ServerConfigModule, DatabaseModule, AuthModule, HealthModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class AppModule {}
