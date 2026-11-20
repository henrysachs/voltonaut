import { z } from "zod";

import type { MailConfig } from "../config.js";
import type { MailSender } from "./mail-sender.js";

interface FetchLike {
  readonly fetch: typeof fetch;
}

const RESEND_SEND_URL = "https://api.resend.com/emails";

const ResendResponseSchema = z.object({ id: z.string() });

export class ResendSender implements MailSender {
  private readonly deps: { readonly mail: Extract<MailConfig, { provider: "resend" }> };
  private readonly fetchFn: typeof fetch;

  public constructor(
    deps: { readonly mail: Extract<MailConfig, { provider: "resend" }> },
    fetchLike?: FetchLike,
  ) {
    this.deps = deps;
    this.fetchFn = fetchLike?.fetch ?? fetch;
  }

  public async sendMagicLink(toEmail: string, linkUrl: string): Promise<void> {
    const response = await this.fetchFn(RESEND_SEND_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${this.deps.mail.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.deps.mail.from,
        to: toEmail,
        subject: "Your Voltonaut login link",
        html: `<p>Sign in to Voltonaut:</p><p><a href="${linkUrl}">${linkUrl}</a></p><p>The link is valid for 15 minutes and can be used once.</p>`,
      }),
    });

    if (!response.ok) {
      throw new Error(`mail: resend send failed with HTTP ${response.status}`);
    }

    const parsed = ResendResponseSchema.safeParse(await response.json());

    if (!parsed.success) {
      throw new Error("mail: unexpected resend response body");
    }
  }
}
