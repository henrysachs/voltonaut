// oxlint-disable-next-line import/no-unassigned-import -- reflect-metadata is a side-effect import; it must register the decorator metadata before Nest resolves modules.
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

const HOST = process.env["HOST"] ?? "127.0.0.1";

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000, HOST);
}

await bootstrap();
