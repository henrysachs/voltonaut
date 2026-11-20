import { z } from "zod";

import type { MailConfig } from "../config.js";
import type { MailSender } from "./mail-sender.js";

interface FetchLike {
  readonly fetch: typeof fetch;
}

const CLOUDFLARE_SEND_URL = "https://api.cloudflare.com/client/v4/accounts";

const CloudflareResponseSchema = z.object({ success: z.literal(true) });

export class CloudflareEmailSender implements MailSender {
  private readonly deps: { readonly mail: Extract<MailConfig, { provider: "cloudflare" }> };
  private readonly fetchFn: typeof fetch;

  public constructor(
    deps: { readonly mail: Extract<MailConfig, { provider: "cloudflare" }> },
    fetchLike?: FetchLike,
  ) {
    this.deps = deps;
    this.fetchFn = fetchLike?.fetch ?? fetch;
  }

  public async sendMagicLink(toEmail: string, linkUrl: string): Promise<void> {
    const accountId = this.deps.mail.cloudflareAccountId;

    if (accountId.length === 0) {
      throw new Error("mail: CLOUDFLARE_EMAIL_ACCOUNT_ID is not configured");
    }

    const response = await this.fetchFn(`${CLOUDFLARE_SEND_URL}/${accountId}/email/sending/send`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${this.deps.mail.cloudflareToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: toEmail,
        from: this.deps.mail.from,
        subject: "Your Voltonaut login link",
        html: magicLinkHtml(linkUrl),
        text: `Sign in to Voltonaut: ${linkUrl}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`mail: cloudflare send failed with HTTP ${response.status}`);
    }

    const parsed = CloudflareResponseSchema.safeParse(await response.json());

    if (!parsed.success) {
      throw new Error("mail: cloudflare send failed (success=false)");
    }
  }
}

function magicLinkHtml(linkUrl: string): string {
  return `<p>Sign in to Voltonaut:</p><p><a href="${linkUrl}">${linkUrl}</a></p><p>The link is valid for 15 minutes and can be used once.</p>`;
}
