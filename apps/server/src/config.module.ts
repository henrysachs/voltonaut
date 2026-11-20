import { Global, Module } from "@nestjs/common";

import { parseServerConfig } from "./config.js";
import { CLOCK } from "./clock.js";

export type { ServerConfig } from "./config.js";

export const SERVER_CONFIG: unique symbol = Symbol("voltonaut:server-config");

@Global()
@Module({
  providers: [
    { provide: CLOCK, useValue: { nowMs: () => Date.now() } },
    {
      provide: SERVER_CONFIG,
      useFactory: () => parseServerConfig(process.env, process.env["NODE_ENV"] ?? "development"),
    },
  ],
  exports: [SERVER_CONFIG, CLOCK],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class ServerConfigModule {}
