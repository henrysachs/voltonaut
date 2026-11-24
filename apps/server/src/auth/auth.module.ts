import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";

import type { ServerConfig } from "../config.module.js";
import { SERVER_CONFIG } from "../config.module.js";
import { MailModule } from "../mail/mail.module.js";
import { AuthController, MeController, OidcController } from "./auth-controllers.js";
import { AuthService } from "./auth.service.js";
import { AuthAccountDataService } from "./auth-account-data.service.js";
import { OidcService } from "./oidc.service.js";
import { authThrottlers } from "./auth-throttlers.js";

@Module({
  imports: [
    MailModule,
    ThrottlerModule.forRootAsync({
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) => ({ throttlers: authThrottlers(config) }),
    }),
  ],
  controllers: [AuthController, OidcController, MeController],
  providers: [AuthService, AuthAccountDataService, OidcService],
  exports: [AuthService, AuthAccountDataService],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class AuthModule {}
