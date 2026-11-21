// oxlint-disable-next-line import/no-unassigned-import -- reflect-metadata is a side-effect import; it must register the decorator metadata before Nest resolves modules.
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { setupHttp } from "./app.setup.js";
import { parseServerConfig } from "./config.js";

export async function bootstrap(): Promise<void> {
  const config = parseServerConfig(process.env, process.env["NODE_ENV"] ?? "development");
  const app = await NestFactory.create(AppModule, { forceCloseConnections: true });

  app.enableShutdownHooks();
  setupHttp(app, config);

  await app.listen(config.http.port, config.http.host);
}

await bootstrap();
