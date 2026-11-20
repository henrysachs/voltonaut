import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { z } from "zod";

export type TokenFault =
  | "none"
  | "nonce"
  | "audience"
  | "issuer"
  | "signature"
  | "expired"
  | "missing-id-token";

interface Authorization {
  readonly nonce: string;
  readonly challenge: string;
  readonly redirectUri: string;
}

interface ProviderControl {
  fault: TokenFault;
  subject: string;
  email: string;
  tokenCalls: number;
  discoveryCalls: number;
  jwksCalls: number;
  failToken: boolean;
  stallToken: boolean;
  failDiscovery: boolean;
  insecureEndpoint: boolean;
  tokenGate: { readonly enter: () => void; readonly wait: Promise<void> } | undefined;
}

interface ProviderRequest {
  readonly url?: string | undefined;
  readonly headers: { readonly authorization?: string | undefined };
  readonly [Symbol.asyncIterator]: () => AsyncIterator<Uint8Array>;
}

interface ProviderResponse {
  readonly setHeader: (name: string, value: string) => object;
  readonly writeHead: (status: number, headers?: Readonly<Record<string, string>>) => object;
  readonly end: (data: string) => object;
}

interface TestTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
}

export class LocalOidcProvider {
  private readonly keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly wrongKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly codes = new Map<string, Authorization>();
  public readonly control: ProviderControl = {
    fault: "none",
    subject: "local-test-subject",
    email: "rider@example.com",
    tokenCalls: 0,
    discoveryCalls: 0,
    jwksCalls: 0,
    failToken: false,
    stallToken: false,
    failDiscovery: false,
    insecureEndpoint: false,
    tokenGate: undefined,
  };
  public issuer = "";
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node HTTP invokes this adapter with mutable native request/response handles.
  private readonly server = createServer((req, res) => {
    this.handle(req, res).catch(() => {
      res.writeHead(500);
      res.end("{}");
    });
  });

  public async listen(port = 0): Promise<void> {
    this.server.listen(port, "127.0.0.1");
    await once(this.server, "listening");
    const address = z.object({ port: z.number() }).parse(this.server.address());
    this.issuer = `http://127.0.0.1:${address.port}`;
  }

  public async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error: Readonly<Error> | undefined) => {
        if (error !== undefined) {
          reject(error);

          return;
        }

        resolve();
      });
    });
  }

  private async handle(req: ProviderRequest, res: ProviderResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.issuer);
    res.setHeader("Content-Type", "application/json");

    switch (url.pathname) {
      case "/.well-known/openid-configuration":
        this.discovery(res);
        break;
      case "/jwks":
        this.control.jwksCalls += 1;
        res.end(
          JSON.stringify({
            keys: [
              {
                ...this.keys.publicKey.export({ format: "jwk" }),
                kid: "test-key",
                alg: "RS256",
                use: "sig",
              },
            ],
          }),
        );
        break;
      case "/authorize":
        this.authorize(url.href, res);
        break;
      case "/token":
        await this.token(req, res);
        break;
      default:
        res.writeHead(404);
        res.end("{}");
    }
  }

  private discovery(res: ProviderResponse): void {
    this.control.discoveryCalls += 1;

    if (this.control.failDiscovery) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "private-provider-diagnostic" }));

      return;
    }

    res.end(
      JSON.stringify({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: this.control.insecureEndpoint
          ? "http://remote.invalid/token"
          : `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      }),
    );
  }

  private authorize(href: string, res: ProviderResponse): void {
    const url = new URL(href);
    const code = randomUUID();
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";

    if (
      url.searchParams.get("code_challenge_method") !== "S256" ||
      url.searchParams.get("scope") !== "openid email" ||
      url.searchParams.get("client_id") !== "test-client"
    ) {
      res.writeHead(400);
      res.end("{}");

      return;
    }

    this.codes.set(code, {
      nonce: url.searchParams.get("nonce") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
      redirectUri,
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    callback.searchParams.set("code", code);
    res.writeHead(302, { Location: callback.href });
    res.end("");
  }

  private async token(req: ProviderRequest, res: ProviderResponse): Promise<void> {
    this.control.tokenCalls += 1;
    this.control.tokenGate?.enter();
    await this.control.tokenGate?.wait;

    if (this.control.stallToken) return;
    let raw = "";

    for await (const chunk of req) raw += Buffer.from(chunk).toString("utf8");
    const body = new URLSearchParams(raw);
    const code = body.get("code") ?? "";
    const authorization = this.codes.get(code);
    this.codes.delete(code);

    const challenge = createHash("sha256")
      .update(body.get("code_verifier") ?? "")
      .digest("base64url");

    if (
      this.control.failToken ||
      authorization === undefined ||
      authorization.challenge !== challenge ||
      authorization.redirectUri !== body.get("redirect_uri") ||
      body.get("grant_type") !== "authorization_code" ||
      req.headers.authorization !==
        `Basic ${Buffer.from("test%2Dclient:test%2Dsecret").toString("base64")}`
    ) {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "private-provider-diagnostic",
        }),
      );

      return;
    }

    const response: TestTokenResponse = {
      access_token: "provider-access-private",
      token_type: "Bearer",
      expires_in: 300,
    };

    if (this.control.fault !== "missing-id-token") response.id_token = this.idToken(authorization);
    res.end(JSON.stringify(response));
  }

  private idToken(authorization: Authorization): string {
    const nowS = Math.floor(Date.now() / 1000);

    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString(
      "base64url",
    );

    const payload = Buffer.from(
      JSON.stringify({
        iss: this.control.fault === "issuer" ? "https://wrong.example" : this.issuer,
        sub: this.control.subject,
        aud: this.control.fault === "audience" ? "wrong-client" : "test-client",
        iat: nowS,
        exp: this.control.fault === "expired" ? nowS - 60 : nowS + 300,
        nonce: this.control.fault === "nonce" ? "wrong-nonce" : authorization.nonce,
        email: this.control.email,
      }),
    ).toString("base64url");

    const signingInput = `${header}.${payload}`;

    const signature = sign(
      "RSA-SHA256",
      Buffer.from(signingInput),
      this.control.fault === "signature" ? this.wrongKeys.privateKey : this.keys.privateKey,
    ).toString("base64url");

    return `${signingInput}.${signature}`;
  }
}

export async function createOidcProvider(): Promise<LocalOidcProvider> {
  const provider = new LocalOidcProvider();
  await provider.listen();

  return provider;
}
