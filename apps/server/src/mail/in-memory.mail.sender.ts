import type { MailSender, SentMail } from "./mail-sender.js";

export class InMemoryMailSender implements MailSender {
  private readonly sent: SentMail[] = [];
  private failNextSend = false;

  public failNext(): void {
    this.failNextSend = true;
  }

  public sendMagicLink(toEmail: string, linkUrl: string): Promise<void> {
    this.sent.push({ toEmail, linkUrl });

    if (this.failNextSend) {
      this.failNextSend = false;

      return Promise.reject(new Error("mail delivery failed"));
    }

    return Promise.resolve();
  }

  public readSent(): readonly SentMail[] {
    return [...this.sent];
  }

  public latestTokenFor(toEmail: string): string | undefined {
    return this.sent.findLast((mail) => mail.toEmail === toEmail)?.linkUrl.split("login=")[1];
  }
}
