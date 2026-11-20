import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";

import { MagicLinkRequestSchema, SessionResponseSchema } from "@voltonaut/shared";
import type { User } from "@voltonaut/shared";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { InMemoryMailSender } from "../mail/in-memory.mail.sender.js";

export { createTestApp } from "./test-bootstrap.spec.js";

export type { TestApp, TestAppOptions } from "./test-bootstrap.spec.js";

interface NestAppPort {
  readonly init: () => Promise<INestApplication>;
  readonly close: () => Promise<void>;
  readonly getHttpServer: () => Server;
  readonly getUrl: () => Promise<string>;
  readonly listen: (port: number, host: string) => Promise<void>;
}

export interface SupertestResponsePort {
  readonly status: number;
  readonly body: unknown;
  readonly headers: { readonly [key: string]: string | undefined };
}

/** The response body as an untrusted boundary value, ready for a Zod parse. */
export function bodyOf(response: SupertestResponsePort): SupertestResponsePort["body"] {
  return response.body;
}

export interface TestSession {
  readonly sessionToken: string;
  readonly user: User;
}

/** Requests a magic link and exchanges it for a bearer session over real HTTP. */
export async function loginTestUser(
  app: NestAppPort,
  mail: Readonly<InMemoryMailSender>,
  email: string,
  forwardedFor = "127.0.0.1:1",
): Promise<TestSession> {
  await request(app.getHttpServer())
    .post("/v1/auth/magic-link")
    .set("X-Forwarded-For", forwardedFor)
    .send({ email })
    .expect(204);

  const loginToken = mail.latestTokenFor(MagicLinkRequestSchema.parse({ email }).email);

  if (loginToken === undefined) {
    throw new Error("test: no magic-link mail was captured");
  }

  const response = await request(app.getHttpServer())
    .post("/v1/auth/session")
    .set("X-Forwarded-For", forwardedFor)
    .send({ loginToken })
    .expect(200);

  return SessionResponseSchema.parse(bodyOf(response));
}

/** Authorizes a supertest request with a bearer session token. */
export function bearer(sessionToken: string) {
  return { Authorization: `Bearer ${sessionToken}` };
}

/** The app's Drizzle instance (Nest resolves the symbol token to `any`). */
export function getDatabase(app: Readonly<INestApplication>): ServerDatabase {
  return app.get<ServerDatabase>(DRIZZLE);
}

export function httpServerOf(app: Readonly<INestApplication<Server>>): Server {
  return app.getHttpServer();
}

export type { NestAppPort };

export interface DatabaseReader {
  readonly $client: { readonly prepare: ServerDatabase["$client"]["prepare"] };
}
