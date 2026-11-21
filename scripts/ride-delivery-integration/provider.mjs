/// <reference types="node" />
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { z } from "../../packages/shared/node_modules/zod/index.js";
import { LocalStravaProvider } from "../../apps/server/src/testing/strava-provider.spec.ts";

const ModeSchema = z.enum(["processing", "complete", "lost", "poll_failure"]);

/** @param {Readonly<FormData>} form */
function multipartFields(form) {
  /** @type {Record<string, string>} */
  const fields = {};

  for (const [key, value] of form) {
    if (key !== "file") fields[key] = z.string().parse(value);
  }

  return fields;
}

class DeliveryProvider {
  /** @type {Readonly<{ id: string; tcx: string; filename: string; fields: Readonly<Record<string, string>>; bytes: number; response: string }>[]} */
  uploads = [];
  /** @type {{ id: string; mode: string }[]} */
  polls = [];
  /** @type {string[]} */
  faults = [];
  mode = ModeSchema.parse("processing");
  held = false;
  authorizeCount = 0;
  /** @type {() => void} */
  unblock = () => {};
  origin = "";
  /** @param {string} secret */
  constructor(secret) {
    this.oauth = new LocalStravaProvider("123", secret);
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node owns HTTP lifecycle handles.
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        this.faults.push(String(error));
        response.writeHead(500);
        response.end("{}");
      });
    });
  }

  async listen() {
    await this.oauth.listen();
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = z.object({ port: z.number() }).parse(this.server.address());

    this.origin = `http://127.0.0.1:${address.port}`;
  }

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This adapter consumes native HTTP streams once.
  async handle(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname.startsWith("/oauth/")) {
      await this.forwardOauth(request, response, url);

      return;
    }

    assert.match(request.headers.authorization ?? "", /^Bearer .+/u);
    assert.ok(
      this.oauth.containsPlaintext(request.headers.authorization ?? ""),
      "Upload uses credentials issued by this OAuth peer",
    );

    if (url.pathname === "/api/v3/uploads" && request.method === "POST") {
      await this.submit(request, response);

      return;
    }

    assert.match(url.pathname, /^\/api\/v3\/uploads\/\d+$/u);
    assert.equal(request.method, "GET");
    const id = z.string().parse(url.pathname.split("/").at(-1));

    assert.ok(this.uploads.some((upload) => upload.id === id));
    this.polls.push({ id, mode: this.mode });
    response.writeHead(this.mode === "poll_failure" ? 503 : 200, this.headers());
    response.end(
      JSON.stringify({
        id_str: id,
        error: null,
        activity_id: this.mode === "complete" ? 9001 : null,
      }),
    );
  }

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response @param {Readonly<URL>} url */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Forward the real OAuth request without replacing state, codes or cookies.
  async forwardOauth(request, response, url) {
    if (url.pathname === "/oauth/authorize") {
      this.authorizeCount += 1;

      if (this.held)
        await new Promise((done) => {
          this.unblock = done;
        });
    }

    const chunks = [];

    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const headers = new Headers({
      "Content-Type": request.headers["content-type"] ?? "application/x-www-form-urlencoded",
    });

    if (request.headers.authorization !== undefined)
      headers.set("Authorization", request.headers.authorization);

    const upstream = await fetch(`${this.oauth.origin}${url.pathname}${url.search}`, {
      method: request.method,
      redirect: "manual",
      headers,
      body: body.length === 0 ? null : body,
    });

    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    response.end(Buffer.from(await upstream.arrayBuffer()));
  }

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Multipart arrives through the native HTTP stream.
  async submit(request, response) {
    const chunks = [];

    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);

    const form = await new Request("http://127.0.0.1/upload", {
      method: "POST",
      headers: { "Content-Type": request.headers["content-type"] ?? "" },
      body: raw,
    }).formData();

    const file = form.get("file");

    assert.ok(file instanceof File, "Actual provider request contains a multipart file");
    const id = String(7000 + this.uploads.length);

    this.uploads.push({
      id,
      tcx: await file.text(),
      filename: file.name,
      fields: multipartFields(form),
      bytes: raw.length,
      response: this.mode === "lost" ? "socket_destroyed_before_headers" : "201_processing",
    });

    if (this.mode === "lost") {
      response.destroy();

      return;
    }

    response.writeHead(201, this.headers());
    response.end(JSON.stringify({ id_str: id, error: null, activity_id: null }));
  }

  headers() {
    const usage = this.uploads.length + this.polls.length;

    return {
      "Content-Type": "application/json",
      "X-RateLimit-Limit": "200,2000",
      "X-RateLimit-Usage": `${usage},${usage}`,
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": `${usage},${usage}`,
    };
  }

  /** @param {string} next */
  setMode(next) {
    this.mode = ModeSchema.parse(next);
  }
  hold() {
    this.held = true;
  }
  release() {
    this.held = false;
    this.unblock();
  }
  snapshot() {
    return {
      uploads: this.uploads,
      polls: this.polls,
      faults: this.faults,
      authorizeCount: this.authorizeCount,
      tokenCalls: this.oauth.control.tokenCalls,
    };
  }
  async close() {
    this.release();
    this.server.closeAllConnections();
    await new Promise((done) => {
      this.server.close(done);
    });
    await this.oauth.close();
  }
}

/** @param {string} secret */
export async function createDeliveryProvider(secret) {
  const provider = new DeliveryProvider(secret);

  await provider.listen();

  return provider;
}
