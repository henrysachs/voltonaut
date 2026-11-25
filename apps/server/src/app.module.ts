import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { ServerConfigModule } from "./config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { APP_PROVIDERS } from "./app.providers.js";
import { applicationModules } from "./app.modules.js";

import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [ServerConfigModule, DatabaseModule, AuthModule, HealthModule, ...applicationModules],
  providers: APP_PROVIDERS,
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class AppModule {}
