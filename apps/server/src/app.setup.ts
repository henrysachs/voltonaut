import type { ServerConfig } from "./config.js";
import { ExpressAdapter } from "@nestjs/platform-express";
import { z } from "zod";

export const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;
const ExpressRequestPathSchema = z.object({ path: z.string() });

interface ExpressSettings {
  readonly set: (setting: string, value: number | boolean | string) => void;
}

interface HttpSetupApp {
  readonly enableCors: (options: {
    readonly origin: readonly string[];
    readonly allowedHeaders: readonly string[];
    readonly credentials: boolean;
  }) => void;
  readonly getHttpAdapter: () => { readonly getInstance: () => ExpressSettings };
}

/**
 * Instance-level HTTP setup shared by `main.ts` and the CORS test: exact
 * origins from config, the headers the client sends, and `trust proxy` so
 * per-IP rate limits see the real client behind Traefik (X-Forwarded-For).
 */
export function setupHttp(app: HttpSetupApp, config: ServerConfig): void {
  const adapter = app.getHttpAdapter();

  if (adapter instanceof ExpressAdapter) {
    adapter.useBodyParser("json", false, {
      limit: 8192,
      inflate: false,
      type: (req: { readonly headers: { readonly "content-type"?: string } }) => {
        const parsed = ExpressRequestPathSchema.safeParse(req);

        return (
          parsed.success &&
          /^\/v1\/strava\/webhook\/?$/iu.test(parsed.data.path) &&
          req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/json"
        );
      },
    });
    adapter.useBodyParser("json", false, { limit: MAX_JSON_BODY_BYTES, inflate: false });
  } else {
    throw new TypeError("HTTP setup requires the Nest Express adapter");
  }

  app.enableCors({
    origin: [...config.cors.origins],
    allowedHeaders: ["Authorization", "Content-Type", "Content-Encoding"],
    credentials: config.auth.mode === "oidc" || config.strava.mode === "enabled",
  });

  const express = app.getHttpAdapter().getInstance();

  express.set("trust proxy", 1);
}
