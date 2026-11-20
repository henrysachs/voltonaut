import { expect, it } from "vitest";
import { z } from "zod";
import { CloudflareEmailSender } from "./cloudflare-email.sender.js";
import { ResendSender } from "./resend.sender.js";
import { AuthService } from "../auth/auth.service.js";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import { MAIL_SENDER } from "./mail-sender.js";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.js";

const cloudflareConfig = {
  mail: {
    provider: "cloudflare",
    from: "login@example.com",
    clientOrigin: "https://web.example",
    cloudflareToken: "test-cf-token",
    cloudflareAccountId: "test-account",
  },
} satisfies Pick<ServerConfig, "mail">;

const resendConfig = {
  mail: {
    provider: "resend",
    from: "login@example.com",
    clientOrigin: "https://web.example",
    resendApiKey: "test-resend-key",
  },
} satisfies Pick<ServerConfig, "mail">;

const MailBodySchema = z.object({
  to: z.string(),
  from: z.string(),
  html: z.string(),
  subject: z.string(),
});

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly contentType: string | null;
  readonly authorization: string | null;
  readonly body: string;
}

function capturingFetch(
  captured: { readonly push: (request: CapturedRequest) => void },
  respond: () => Response,
): typeof fetch {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Implements the platform fetch signature with native mutable request inputs.
  return async (input, init) => {
    const request = new Request(input, init);

    captured.push({
      url: request.url,
      method: request.method,
      contentType: request.headers.get("Content-Type"),
      authorization: request.headers.get("Authorization"),
      body: await request.text(),
    });

    return respond();
  };
}

it("posts validated Cloudflare and Resend requests without network calls", async () => {
  const requests: CapturedRequest[] = [];

  const capture = {
    push: (value: CapturedRequest) => {
      requests.push(value);
    },
  };

  const cloudflare = new CloudflareEmailSender(cloudflareConfig, {
    fetch: capturingFetch(capture, () => Response.json({ success: true })),
  });

  const resend = new ResendSender(resendConfig, {
    fetch: capturingFetch(capture, () => Response.json({ id: "test-mail" })),
  });

  await cloudflare.sendMagicLink("rider@example.com", "https://web.example/#login=opaque");
  await resend.sendMagicLink("rider@example.com", "https://web.example/#login=opaque");
  expect(requests.map((value) => value.url)).toEqual([
    "https://api.cloudflare.com/client/v4/accounts/test-account/email/sending/send",
    "https://api.resend.com/emails",
  ]);

  for (const value of requests) {
    expect(value.method).toBe("POST");
    expect(value.contentType).toBe("application/json");
    const body = MailBodySchema.parse(JSON.parse(value.body));
    expect(body.to).toBe("rider@example.com");
    expect(body.from).toBe("login@example.com");
    expect(body.html).toContain("https://web.example/#login=opaque");
  }

  expect(requests[0]?.authorization).toBe("Bearer test-cf-token");
  expect(requests[1]?.authorization).toBe("Bearer test-resend-key");
});

it("fails closed on HTTP errors and malformed provider replies", async () => {
  const capture = { push: () => {} };

  await Promise.all(
    [() => new Response("{}", { status: 429 }), () => Response.json({ success: false })].map(
      async (respond) => {
        await expect(
          new CloudflareEmailSender(cloudflareConfig, {
            fetch: capturingFetch(capture, respond),
          }).sendMagicLink("rider@example.com", "https://web.example/#login=opaque"),
        ).rejects.toThrow("mail:");
      },
    ),
  );

  await Promise.all(
    [() => new Response("{}", { status: 500 }), () => Response.json({})].map(async (respond) => {
      await expect(
        new ResendSender(resendConfig, { fetch: capturingFetch(capture, respond) }).sendMagicLink(
          "rider@example.com",
          "https://web.example/#login=opaque",
        ),
      ).rejects.toThrow("mail:");
    }),
  );
});

it("removes a token after delivery failure without leaking provider details", async () => {
  const { app } = await createTestApp();

  try {
    const auth = new AuthService(
      getDatabase(app),
      { sendMagicLink: () => Promise.reject(new Error("secret provider response")) },
      app.get<ServerConfig>(SERVER_CONFIG),
    );

    await expect(auth.requestMagicLink("failure@example.com", 1000)).rejects.toThrow(
      "mail delivery unavailable",
    );
    expect(getDatabase(app).$client.prepare("SELECT token_hash FROM login_tokens").all()).toEqual(
      [],
    );
    expect(app.get(MAIL_SENDER)).toBeDefined();
  } finally {
    await app.close();
  }
});
