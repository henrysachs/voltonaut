import { Global, Module } from "@nestjs/common";

import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.js";
import { DRIZZLE, createDatabase } from "./drizzle.provider.js";
import { DatabaseLifecycle } from "./database.lifecycle.js";

@Global()
@Module({
  providers: [
    DatabaseLifecycle,
    {
      provide: DRIZZLE,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) => createDatabase(config),
    },
  ],
  exports: [DRIZZLE],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class DatabaseModule {}
