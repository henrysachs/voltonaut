import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module.js";
import { setupHttp } from "../app.setup.js";
import { testServerConfig } from "../config.js";
import type { ServerConfig } from "../config.js";
import { SERVER_CONFIG } from "../config.module.js";
import { InMemoryMailSender } from "../mail/in-memory.mail.sender.js";
import { MAIL_SENDER } from "../mail/mail-sender.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";

export interface TestApp {
  readonly app: INestApplication;
  readonly config: ServerConfig;
  readonly mail: InMemoryMailSender;
}

export interface TestAppOptions {
  readonly config?: Partial<ServerConfig>;
  readonly clock?: Clock;
}

export async function createTestApp(options?: TestAppOptions): Promise<TestApp> {
  const config = testServerConfig(options?.config);
  const mail = new InMemoryMailSender();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SERVER_CONFIG)
    .useValue(config)
    .overrideProvider(MAIL_SENDER)
    .useValue(mail)
    .overrideProvider(CLOCK)
    .useValue(options?.clock ?? { nowMs: () => Date.now() })
    .compile();

  const app = moduleRef.createNestApplication();
  setupHttp(app, config);
  await app.init();

  return { app, config, mail };
}
