import { StravaBridgeMessageSchema } from "@voltonaut/shared";
import type { LeaseBinding } from "./apiRoute.js";
import type { StravaPort } from "./stravaPort.js";
import { stravaAuthorizationUrl } from "./stravaAuthorizationUrl.js";

/** Strava owns its connection and deliveries; it sees no other account capability. */
export type StravaLease = LeaseBinding & { readonly strava: StravaPort };

export interface StravaChannel {
  readonly send: (message: Parameters<typeof StravaBridgeMessageSchema.parse>[0]) => void;
  readonly listen: (
    listener: (message: Parameters<typeof StravaBridgeMessageSchema.parse>[0]) => void,
  ) => () => void;
  readonly close: () => void;
}

export interface StravaPopup {
  readonly channel: (id: string) => StravaChannel;
  readonly open: (path: string) => void;
  readonly uuid: () => string;
  readonly origin: string;
}

interface FlowOptions {
  readonly lease: StravaLease;
  readonly popup: StravaPopup;
  readonly report: (message: string) => void;
  readonly refresh: () => Promise<void>;
  readonly finished: () => void;
}

class StravaConnectionFlow {
  #state: "ready" | "starting" | "code" | "confirming" | "closed" = "ready";
  readonly #channel: StravaChannel;
  readonly #id: string;
  readonly #unlisten: () => void;
  #deadline: ReturnType<typeof setTimeout> | undefined;
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #cancel = () => {
    this.close();
    this.options.report("Strava-Verbindung verworfen. Session oder Konto geändert.");
  };
  constructor(private readonly options: FlowOptions) {
    this.#id = options.popup.uuid();
    this.#channel = options.popup.channel(this.#id);
    this.#unlisten = this.#channel.listen((raw) => {
      this.message(raw);
    });
  }
  open(): void {
    this.options.lease.signal.addEventListener("abort", this.#cancel, { once: true });
    this.#deadline = setTimeout(() => {
      this.close();
      this.options.report(
        "Strava-Fenster nicht erreichbar oder abgelaufen. Erneut nur per Klick starten.",
      );
    }, 300000);
    this.#readyTimer = setTimeout(() => {
      if (this.#state === "ready") {
        this.close();
        this.options.report("Popup blockiert oder Bereitschaft fehlt. Keine Verbindung gestartet.");
      }
    }, 5000);
    this.options.popup.open(`/strava/bridge?channel=${this.#id}`);
  }
  close(): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    clearTimeout(this.#deadline);
    clearTimeout(this.#readyTimer);
    this.#unlisten();
    this.#channel.close();
    this.options.lease.signal.removeEventListener("abort", this.#cancel);
    this.options.finished();
  }
  private message(raw: Parameters<typeof StravaBridgeMessageSchema.parse>[0]): void {
    const parsed = StravaBridgeMessageSchema.safeParse(raw);

    if (!parsed.success || parsed.data.channel !== this.#id || this.#state === "closed") return;

    if (!this.options.lease.current()) {
      this.#cancel();

      return;
    }

    const message = parsed.data;

    if (message.type === "ready" && this.#state === "ready") {
      this.#state = "starting";
      clearTimeout(this.#readyTimer);
      void this.start();
    } else if (message.type === "finish" && this.#state === "code") {
      if (message.result.kind === "denied") {
        this.close();
        this.options.report("Strava-Zustimmung abgelehnt. Keine Verbindung aktiviert.");

        return;
      }

      this.#state = "confirming";
      void this.confirm(message.result.code);
    }
  }
  private async start(): Promise<void> {
    try {
      const response = await this.options.lease.strava.start(this.#id);

      if (!this.options.lease.current() || this.#state !== "starting") return;

      const authorizationUrl = stravaAuthorizationUrl(
        response.authorizationUrl,
        this.options.lease.apiOrigin,
        this.options.popup.origin,
      );

      this.#state = "code";
      this.#channel.send({ v: 1, type: "authorize", channel: this.#id, authorizationUrl });
      this.options.report("Zustimmung im Strava-Fenster bestätigen. Dieser Tab bleibt geöffnet.");
    } catch {
      if (this.options.lease.current() && this.#state !== "closed") {
        this.close();
        this.options.report("Strava-Start fehlgeschlagen. Browsercookie und Verbindung prüfen.");
      }
    }
  }
  private async confirm(code: string): Promise<void> {
    try {
      const status = await this.options.lease.strava.confirm(code);

      if (!this.options.lease.current() || this.#state !== "confirming") return;

      if (status.status !== "connected") throw new Error("connection not confirmed");
      this.#channel.send({ v: 1, type: "ack", channel: this.#id, outcome: "confirmed" });
      this.close();
      this.options.report("Strava-Verbindung bestätigt. Jede Fahrt separat freigeben.");
    } catch {
      if (!this.options.lease.current() || this.#state === "closed") return;
      this.close();
      this.options.report(
        "Bestätigungsantwort fehlt oder wurde abgelehnt. Status wird geprüft, keine neue Autorisierung.",
      );
    }

    if (this.options.lease.current()) await this.options.refresh();
  }
}

export function connectStrava(
  lease: StravaLease,
  popup: StravaPopup,
  report: (message: string) => void,
  refresh: () => Promise<void>,
  finished: () => void,
): () => void {
  let flow: StravaConnectionFlow | undefined;

  try {
    flow = new StravaConnectionFlow({ lease, popup, report, refresh, finished });
    flow.open();
  } catch {
    flow?.close();
    report("Popup oder BroadcastChannel fehlt oder ist gesperrt. Keine Weiterleitung gestartet.");
    finished();
  }

  return () => {
    flow?.close();
  };
}

export function browserStravaPopup(): StravaPopup {
  return {
    origin: window.location.origin,
    uuid: () => crypto.randomUUID(),
    open: (path) => {
      window.open(path, "_blank", "noopener,noreferrer");
    },
    channel: (id) => {
      const channel = new BroadcastChannel(`voltonaut-strava:${id}`);

      return {
        send: (message) => {
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Native BroadcastChannel has no targetOrigin argument and is same-origin scoped.
          channel.postMessage(message);
        },
        listen: (listener) => {
          const handler = (event: { readonly data: unknown }) => {
            listener(event.data);
          };

          channel.addEventListener("message", handler);

          return () => {
            channel.removeEventListener("message", handler);
          };
        },
        close: () => {
          channel.close();
        },
      };
    },
  };
}
