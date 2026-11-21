import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { ServerConfigModule } from "./config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { APP_PROVIDERS } from "./app.providers.js";

import { HealthModule } from "./health/health.module.js";
import { AccountsModule } from "./accounts/accounts.module.js";
import { RidesModule } from "./rides/rides.module.js";
import { accountsTables, ridesTables, stravaTables } from "./schema.js";
import { StravaModule } from "./strava/strava.module.js";

const ridesModule = RidesModule.register(ridesTables);

@Module({
  imports: [
    ServerConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    AccountsModule.register(accountsTables),
    ridesModule,
    StravaModule.register(stravaTables, ridesModule),
  ],
  providers: APP_PROVIDERS,
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class AppModule {}
