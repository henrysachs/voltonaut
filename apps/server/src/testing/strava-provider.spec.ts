import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { z } from "zod";

interface ProviderRequest {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
  readonly headers: { readonly authorization?: string | undefined };
  readonly [Symbol.asyncIterator]: () => AsyncIterator<Uint8Array>;
}

interface ProviderResponse {
  readonly writeHead: (status: number, headers?: Readonly<Record<string, string>>) => void;
  readonly end: (data?: string) => void;
}

interface ProviderControl {
  athleteId: number;
  scope: string;
  tokenFault:
    | "none"
    | "http"
    | "invalid-json"
    | "missing-token"
    | "athlete"
    | "expired"
    | "oversized"
    | "stall";
  revokeFault: "none" | "http" | "stall";
  deny: boolean;
  tokenCalls: number;
  revokeCalls: number;
  validClientCalls: number;
  unexpectedCalls: number;
  tokenGate: { readonly enter: () => void; readonly wait: Promise<void> } | undefined;
}

/** Local protocol peer. No real credentials, API calls or test-runner dependencies. */
export class LocalStravaProvider {
  public origin = "";
  public readonly control: ProviderControl = {
    athleteId: 42,
    scope: "activity:write",
    tokenFault: "none",
    revokeFault: "none",
    deny: false,
    tokenCalls: 0,
    revokeCalls: 0,
    validClientCalls: 0,
    unexpectedCalls: 0,
    tokenGate: undefined,
  };
  private readonly codes = new Set<string>();
  private readonly refreshTokens = new Set<string>();
  private readonly issuedTokens = new Set<string>();
  private readonly clientId: string;
  private readonly clientSecret: string;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node provides mutable HTTP handles to this adapter.
  private readonly server = createServer((req, res) => {
    this.handle(req, res).catch(() => {
      res.writeHead(500);
      res.end("{}");
    });
  });
  public constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }
  public async listen(): Promise<void> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    this.origin = `http://127.0.0.1:${z.object({ port: z.number() }).parse(this.server.address()).port}`;
  }
  public async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error: Readonly<Error> | undefined) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }
  public containsPlaintext(value: string): boolean {
    for (const token of this.issuedTokens) if (value.includes(token)) return true;

    return value.includes(this.clientSecret);
  }
  private async handle(req: ProviderRequest, res: Readonly<ProviderResponse>): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin);

    if (url.pathname === "/oauth/authorize" && req.method === "GET") {
      this.authorize(url, res);

      return;
    }

    const chunks: Uint8Array[] = [];

    for await (const chunk of req) chunks.push(chunk);
    const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));

    if (url.pathname === "/oauth/token" && req.method === "POST") {
      await this.token(body, res);

      return;
    }

    if (url.pathname === "/oauth/revoke" && req.method === "POST") {
      this.revoke(req.headers.authorization, body, res);

      return;
    }

    this.control.unexpectedCalls += 1;
    res.writeHead(404);
    res.end("{}");
  }

  private authorize(
    url: { readonly searchParams: { readonly get: (name: string) => string | null } },
    res: Readonly<ProviderResponse>,
  ): void {
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "http://invalid.local");

    if (
      url.searchParams.get("client_id") !== this.clientId ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("scope") !== "activity:write" ||
      !["127.0.0.1", "localhost"].includes(callback.hostname)
    ) {
      res.writeHead(400);
      res.end("{}");

      return;
    }

    const code = randomBytes(32).toString("base64url");
    this.codes.add(code);
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");

    if (this.control.deny) callback.searchParams.set("error", "access_denied");
    else {
      callback.searchParams.set("code", code);
      callback.searchParams.set("scope", this.control.scope);
    }

    res.writeHead(302, { Location: callback.href });
    res.end();
  }

  private tokenFault(res: Readonly<ProviderResponse>): boolean {
    switch (this.control.tokenFault) {
      case "stall":
        return true;
      case "http":
        res.writeHead(503);
        res.end("private-provider-diagnostic");

        return true;
      case "invalid-json":
        res.end("not-json");

        return true;
      case "oversized":
        res.end("x".repeat(20_000));

        return true;
      case "none":
      case "missing-token":
      case "athlete":
      case "expired":
        return false;
      default:
        throw new Error("unsupported local token fault");
    }
  }

  private async token(
    body: Readonly<URLSearchParams>,
    res: Readonly<ProviderResponse>,
  ): Promise<void> {
    this.control.tokenCalls += 1;

    if (
      body.get("client_id") !== this.clientId ||
      body.get("client_secret") !== this.clientSecret ||
      body.get("grant_type") !== "authorization_code" ||
      !this.codes.delete(body.get("code") ?? "")
    ) {
      res.writeHead(401);
      res.end("{}");

      return;
    }

    this.control.validClientCalls += 1;
    this.control.tokenGate?.enter();
    await this.control.tokenGate?.wait;

    if (this.tokenFault(res)) return;
    const refreshToken = randomBytes(32).toString("hex");
    const accessToken = randomBytes(32).toString("hex");
    this.refreshTokens.add(refreshToken);
    this.issuedTokens.add(refreshToken);
    this.issuedTokens.add(accessToken);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        token_type: "Bearer",
        access_token: this.control.tokenFault === "missing-token" ? "" : accessToken,
        refresh_token: refreshToken,
        expires_at:
          this.control.tokenFault === "expired" ? 1 : Math.floor(Date.now() / 1000) + 21600,
        expires_in: 21600,
        athlete: {
          id: this.control.tokenFault === "athlete" ? 9007199254740992 : this.control.athleteId,
        },
        scope: this.control.scope,
      }),
    );
  }

  private revoke(
    authorization: string | undefined,
    body: Readonly<URLSearchParams>,
    res: Readonly<ProviderResponse>,
  ): void {
    this.control.revokeCalls += 1;

    if (
      authorization !==
        `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}` ||
      body.get("token_type_hint") !== "refresh_token" ||
      !this.refreshTokens.has(body.get("token") ?? "")
    ) {
      res.writeHead(401);
      res.end();

      return;
    }

    if (this.control.revokeFault === "stall") return;

    if (this.control.revokeFault === "http") {
      res.writeHead(503);
      res.end();

      return;
    }

    res.writeHead(200);
    res.end();
  }
}
