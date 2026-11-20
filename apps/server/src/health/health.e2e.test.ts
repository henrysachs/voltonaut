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
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers over real HTTP and matches the shared response schema", async () => {
    const baseUrl = await app.getUrl();
    const response = await request(baseUrl).get("/healthz").expect(200);

    const body = HealthResponseSchema.parse(response.body);

    expect(body.status).toBe("ok");
    expect(body.version).toBe(SERVER_VERSION);
    expect(body.uptimeS).toBeGreaterThanOrEqual(0);
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
