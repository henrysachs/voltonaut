import { readFileSync } from "node:fs";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { HealthResponseSchema } from "@voltonaut/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { SERVER_VERSION } from "../version.js";

const fixtureUrl = new URL("../../../../fixtures/api/health.response.json", import.meta.url);

describe("GET /healthz", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("matches the shared response schema", async () => {
    const response = await request(app.getHttpServer()).get("/healthz").expect(200);

    const parsed = HealthResponseSchema.safeParse(response.body);

    if (!parsed.success) {
      throw new Error("health response does not match the shared schema");
    }

    expect(parsed.data.status).toBe("ok");
    expect(parsed.data.version).toBe(SERVER_VERSION);
    expect(parsed.data.uptimeS).toBeGreaterThanOrEqual(0);
  });

  it("accepts the contract fixture", () => {
    const fixture = HealthResponseSchema.parse(JSON.parse(readFileSync(fixtureUrl, "utf8")));

    expect(fixture).toEqual({
      status: "ok",
      version: "0.1.0",
      uptimeS: 12.5,
    });
  });
});
