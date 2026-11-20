import type { ServerConfig } from "./config.js";
import { ExpressAdapter } from "@nestjs/platform-express";

export const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;

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
    adapter.useBodyParser("json", false, { limit: MAX_JSON_BODY_BYTES, inflate: false });
  } else {
    throw new TypeError("HTTP setup requires the Nest Express adapter");
  }

  app.enableCors({
    origin: [...config.cors.origins],
    allowedHeaders: ["Authorization", "Content-Type", "Content-Encoding"],
    credentials: config.auth.mode === "oidc",
  });

  const express = app.getHttpAdapter().getInstance();

  express.set("trust proxy", 1);
}
