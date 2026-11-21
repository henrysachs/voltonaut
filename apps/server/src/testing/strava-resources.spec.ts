export interface StravaResourceRequest {
  readonly method?: string | undefined;
  readonly headers: {
    readonly authorization?: string | undefined;
    readonly "content-type"?: string | undefined;
  };
  readonly [Symbol.asyncIterator]: () => AsyncIterator<Uint8Array>;
}

const RATE_HEADERS = {
  "Content-Type": "application/json",
  "X-RateLimit-Limit": "100,1000",
  "X-RateLimit-Usage": "1,1",
  "X-ReadRateLimit-Limit": "100,1000",
  "X-ReadRateLimit-Usage": "1,1",
};

interface ResourceResponse {
  readonly writeHead: (status: number, headers?: Readonly<Record<string, string>>) => void;
  readonly end: (data?: string) => void;
  readonly destroy: () => void;
}

async function multipart(req: StravaResourceRequest): Promise<FormData> {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of req) {
    length += chunk.byteLength;

    if (length > 1048576) throw new Error("local provider multipart exceeds test limit");
    chunks.push(chunk);
  }

  const response = new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": req.headers["content-type"] ?? "" },
  });

  // oxlint-disable-next-line typescript/no-deprecated -- Only this bounded loopback test peer parses its own trusted multipart; no production request uses Body.formData.
  return response.formData();
}

export class LocalStravaResources {
  public submitCalls = 0;
  public pollCalls = 0;
  public refreshCalls = 0;
  public submission: "processing" | "lost" | "invalid" | "http" = "processing";
  public processing:
    | "processing"
    | "delivered"
    | "unsafe"
    | "html_error"
    | "http"
    | "foreign"
    | "authorization" = "processing";
  public refreshFault: "none" | "lost" | "http" = "none";
  public refreshGate: { readonly enter: () => void; readonly wait: Promise<void> } | undefined;
  public pollGate: { readonly enter: () => void; readonly wait: Promise<void> } | undefined;
  public multipart: FormData | undefined;
  readonly #accessTokens = new Set<string>();
  readonly #refreshTokens = new Map<string, string>();

  authorize(accessToken: string, refreshToken: string): void {
    this.#accessTokens.add(accessToken);
    this.#refreshTokens.set(refreshToken, accessToken);
  }

  revoke(refreshToken: string): void {
    const access = this.#refreshTokens.get(refreshToken);

    if (access !== undefined) this.#accessTokens.delete(access);
    this.#refreshTokens.delete(refreshToken);
  }

  async refresh(body: Readonly<URLSearchParams>, res: ResourceResponse): Promise<void> {
    this.refreshCalls += 1;

    if (!this.#refreshTokens.delete(body.get("refresh_token") ?? "")) {
      res.writeHead(400);
      res.end("{}");

      return;
    }

    const access = crypto.randomUUID();
    const refresh = crypto.randomUUID();
    this.authorize(access, refresh);
    this.refreshGate?.enter();
    await this.refreshGate?.wait;

    if (this.refreshFault === "lost") {
      res.destroy();

      return;
    }

    if (this.refreshFault === "http") {
      res.writeHead(503);
      res.end("{}");

      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        token_type: "Bearer",
        access_token: access,
        refresh_token: refresh,
        expires_at: Math.floor(Date.now() / 1000) + 21600,
      }),
    );
  }

  async handle(req: StravaResourceRequest, res: ResourceResponse): Promise<void> {
    const authorization = req.headers.authorization ?? "";

    if (!authorization.startsWith("Bearer ") || !this.#accessTokens.has(authorization.slice(7))) {
      res.writeHead(401);
      res.end("{}");

      return;
    }

    if (req.method === "POST") {
      this.submitCalls += 1;
      this.multipart = await multipart(req);

      if (this.submission === "lost") {
        res.destroy();

        return;
      }

      res.writeHead(this.submission === "http" ? 503 : 201, RATE_HEADERS);
      res.end(
        this.submission === "invalid"
          ? "not json"
          : JSON.stringify({ id_str: "12345678901234567890", error: null, activity_id: null }),
      );

      return;
    }

    this.pollCalls += 1;
    this.pollGate?.enter();
    await this.pollGate?.wait;
    res.writeHead(
      this.processing === "authorization" ? 401 : this.processing === "http" ? 503 : 200,
      RATE_HEADERS,
    );
    res.end(
      JSON.stringify({
        id_str: this.processing === "foreign" ? "99" : "12345678901234567890",
        error: this.processing === "html_error" ? "<img src=x onerror=alert(1)> duplicate" : null,
        activity_id:
          this.processing === "unsafe"
            ? 9007199254740992
            : this.processing === "processing" || this.processing === "http"
              ? null
              : 321,
      }),
    );
  }
}
