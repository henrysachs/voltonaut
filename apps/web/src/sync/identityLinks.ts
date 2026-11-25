import type { LinkedIdentity, OidcProviderChoice } from "@voltonaut/shared";
import type { SessionView } from "./applicationSession.js";
import type { AccountLease } from "./privateAuthTransport.js";
import { PrivateRequestError, type SyncFailure } from "./privateAuthTransport.js";

export type IdentityLinksView =
  | { readonly kind: "hidden"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly linked: readonly LinkedIdentity[];
      readonly available: readonly OidcProviderChoice[];
      readonly message: string;
      readonly busy: boolean;
      /**
       * False for a session that lives only in this tab: the provider login leaves the page, which
       * would drop the only copy of the session and the link could never be completed.
       */
      readonly linkable: boolean;
    };

/** The part of an account lease this section uses. */
export type IdentityLinksLease = Pick<AccountLease, "identities" | "current" | "generation">;

interface IdentityLinksOptions {
  readonly session: {
    readonly authorize: () => IdentityLinksLease | undefined;
    readonly subscribe: (listener: (view: SessionView) => void) => () => void;
  };
  /** Login providers the server offers; empty when OIDC is not active. */
  readonly providers: () => Promise<readonly OidcProviderChoice[]>;
  /** Continues the fresh provider login in this tab. */
  readonly redirect: (location: string) => void;
}

const RETRY_TEXT = "Verbindung nicht bestätigt. Bitte erneut versuchen.";

export const TAB_ONLY_TEXT =
  "Weitere Anmeldungen lassen sich nur verbinden, wenn die Anmeldung im Browser gespeichert werden kann. Diese Sitzung gilt nur in diesem Tab und ginge beim Wechsel zum Anbieter verloren. Browser-Speicher für Voltonaut erlauben und neu anmelden.";

function causeText(cause: SyncFailure): string {
  switch (cause) {
    case "conflict":
      return "Diese Anmeldung gehört bereits zu einem anderen Voltonaut-Konto. Nichts wurde verbunden.";
    case "reauth":
      return "Verbindung nicht abgeschlossen: Sitzung abgelaufen, abgemeldet oder gewechselt. Bitte erneut verbinden.";
    case "contract":
    case "forbidden":
    case "missing":
    case "retry":
    case "superseded":
      return RETRY_TEXT;
    default: {
      const exhausted: never = cause;

      return exhausted;
    }
  }
}

function failureText(error: Readonly<Error>): string {
  return error instanceof PrivateRequestError ? causeText(error.cause) : RETRY_TEXT;
}

/**
 * Shows the login identities of the signed-in account and connects further providers. A link
 * code returned by the provider is only completed by the confirmed session that started it.
 */
export class IdentityLinks {
  readonly #options: IdentityLinksOptions;
  readonly #listeners = new Set<(view: IdentityLinksView) => void>();
  #view: IdentityLinksView = { kind: "hidden", message: "" };
  #pending: string | undefined;
  #generation: number | undefined;
  #persistent = false;

  constructor(options: IdentityLinksOptions) {
    this.#options = options;
    options.session.subscribe((view) => {
      void this.#sessionChanged(view);
    });
  }

  subscribe(listener: (view: IdentityLinksView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Remembers a link code from the finish page until the stored session is confirmed. */
  completePending(code: string): void {
    this.#pending = code;
  }

  async connect(providerId: string): Promise<void> {
    const lease = this.#options.session.authorize();
    const view = this.#view;

    if (lease === undefined || view.kind !== "ready") return;

    if (!view.linkable) {
      // Republishing an unchanged view would rebuild the buttons and drop keyboard focus.
      if (view.message !== TAB_ONLY_TEXT) this.#publish({ ...view, message: TAB_ONLY_TEXT });

      return;
    }

    this.#publish({ ...view, busy: true, message: "Anmeldung beim Anbieter wird vorbereitet …" });

    try {
      const started = await lease.identities.startLink(providerId);

      if (lease.current()) this.#options.redirect(started.location);
    } catch (error) {
      if (lease.current() && error instanceof Error)
        this.#publish({ ...view, busy: false, message: failureText(error) });
    }
  }

  /** Called once the stored session was checked: a link code without that session is dropped. */
  settle(): void {
    if (this.#pending === undefined) return;
    this.#pending = undefined;
    this.#publish({ kind: "hidden", message: failureText(new PrivateRequestError("reauth")) });
  }

  async #sessionChanged(view: SessionView): Promise<void> {
    if (view.kind !== "authenticated") {
      if (view.kind === "guest") this.#generation = undefined;

      this.#publish({ kind: "hidden", message: "" });

      return;
    }

    this.#persistent = view.persistent;
    const lease = this.#options.session.authorize();

    if (lease === undefined || lease.generation === this.#generation) return;
    this.#generation = lease.generation;
    await this.#load(lease);
  }

  async #load(lease: IdentityLinksLease): Promise<void> {
    const pending = this.#pending;
    this.#pending = undefined;
    let message = "";

    if (pending !== undefined) {
      message = await lease.identities.completeLink(pending).then(
        () => "Anmeldung verbunden. Beide Anbieter führen jetzt zu diesem Konto.",
        (error: Readonly<Error>) => failureText(error),
      );
    }

    try {
      const [providers, listed] = await Promise.all([
        this.#options.providers(),
        lease.identities.list(),
      ]);

      if (!lease.current()) return;
      const linked = new Set(listed.identities.map((identity) => identity.providerId));
      const available = providers.filter((provider) => !linked.has(provider.id));
      const linkable = this.#persistent;

      this.#publish({
        kind: "ready",
        linked: listed.identities,
        available,
        message: message === "" && !linkable && available.length > 0 ? TAB_ONLY_TEXT : message,
        busy: false,
        linkable,
      });
    } catch (error) {
      if (lease.current() && error instanceof Error)
        this.#publish({ kind: "hidden", message: message === "" ? failureText(error) : message });
    }
  }

  #publish(view: IdentityLinksView): void {
    this.#view = view;

    for (const listener of this.#listeners) listener(view);
  }
}
