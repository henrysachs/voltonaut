// oxlint-disable-next-line import/no-unassigned-import -- reflect-metadata is a side-effect import; it must register the decorator metadata before Nest resolves modules.
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { setupHttp } from "./app.setup.js";
import { parseServerConfig } from "./config.js";
import { adminMain } from "./admin.js";
import { checkConfigMain } from "./check-config.js";

export async function bootstrap(): Promise<void> {
  const config = parseServerConfig(process.env, process.env["NODE_ENV"] ?? "development");
  const app = await NestFactory.create(AppModule, { forceCloseConnections: true });

  app.enableShutdownHooks();
  setupHttp(app, config);

  await app.listen(config.http.port, config.http.host);
}

const args = process.argv.slice(2);

if (args.length === 0) await bootstrap();
else if (args[0] === "admin") adminMain(args.slice(1));
else if (args[0] === "check-config") checkConfigMain(args.slice(1));
else
  throw new Error(
    "usage: node dist/main.js [admin list [cursor] | admin grant|revoke <userId> | check-config]",
  );
