import type { ServerConfig } from "./config.js";

interface ExpressSettings {
  readonly set: (setting: string, value: number | boolean | string) => void;
}

interface HttpSetupApp {
  readonly enableCors: (options: {
    readonly origin: readonly string[];
    readonly allowedHeaders: readonly string[];
  }) => void;
  readonly getHttpAdapter: () => { readonly getInstance: () => ExpressSettings };
}

/**
 * Instance-level HTTP setup shared by `main.ts` and the CORS test: exact
 * origins from config, the headers the client sends, and `trust proxy` so
 * per-IP rate limits see the real client behind Traefik (X-Forwarded-For).
 */
export function setupHttp(app: HttpSetupApp, config: ServerConfig): void {
  app.enableCors({
    origin: [...config.cors.origins],
    allowedHeaders: ["Authorization", "Content-Type", "Content-Encoding"],
  });

  const express = app.getHttpAdapter().getInstance();

  express.set("trust proxy", 1);
}
