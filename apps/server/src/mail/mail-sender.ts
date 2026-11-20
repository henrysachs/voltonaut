import type { ServerConfig } from "../config.js";
import { CloudflareEmailSender } from "./cloudflare-email.sender.js";
import { InMemoryMailSender } from "./in-memory.mail.sender.js";
import { ResendSender } from "./resend.sender.js";

/** Transport-agnostic way to send the magic-link mail (E5 spec AK6). */
export interface MailSender {
  readonly sendMagicLink: (toEmail: string, linkUrl: string) => Promise<void>;
}

export const MAIL_SENDER: unique symbol = Symbol("voltonaut:mail-sender");

export interface SentMail {
  readonly toEmail: string;
  readonly linkUrl: string;
}

/** Selects the provider purely from configuration; no code change needed to switch. */
export function createMailSender(config: Pick<ServerConfig, "mail">): MailSender {
  const mail = config.mail;

  switch (mail.provider) {
    case "cloudflare":
      return new CloudflareEmailSender({ mail });
    case "resend":
      return new ResendSender({ mail });
    case "memory":
      return new InMemoryMailSender();
    default: {
      const exhaustive: never = mail;
      throw new Error("Unsupported mail provider", { cause: exhaustive });
    }
  }
}
