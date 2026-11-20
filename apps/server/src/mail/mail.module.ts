import { Module } from "@nestjs/common";

import type { ServerConfig } from "../config.js";
import { SERVER_CONFIG } from "../config.module.js";
import { createMailSender } from "./mail-sender.js";
import { MAIL_SENDER } from "./mail-sender.js";

@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) => createMailSender(config),
    },
  ],
  exports: [MAIL_SENDER],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class MailModule {}
