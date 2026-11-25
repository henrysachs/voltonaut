import type { LinkedIdentity, OidcProviderChoice } from "@voltonaut/shared";
import { PrivateRequestError, type LeaseBinding, type SyncFailure } from "./apiRoute.js";
import type { IdentityPort } from "./identityPort.js";
import type { AccountScope } from "./accountScope.js";
import { AccountState } from "./accountState.js";

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
export type IdentityLinksLease = LeaseBinding & { readonly identities: IdentityPort };

interface IdentityLinksOptions {
  readonly scope: AccountScope<IdentityLinksLease>;
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
  readonly #state: AccountState<IdentityLinksView, IdentityLinksLease>;
  #pending: string | undefined;
  #persistent = false;

  constructor(options: IdentityLinksOptions) {
    this.#options = options;
    this.#state = new AccountState<IdentityLinksView, IdentityLinksLease>(
      { kind: "hidden", message: "" },
      {
        enter: (binding, previous) => {
          if (binding.kind === "signedOut") return { kind: "hidden", message: "" };
          this.#persistent = binding.persistent;

          // The section stays as it is until the new account's logins are listed.
          return previous;
        },
        start: ({ lease }) => {
          void this.#load(lease);
        },
      },
    );
    this.#state.follow(options.scope);
  }

  subscribe(listener: (view: IdentityLinksView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  /** Remembers a link code from the finish page until the stored session is confirmed. */
  completePending(code: string): void {
    this.#pending = code;
  }

  async connect(providerId: string): Promise<void> {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (lease === undefined || view.kind !== "ready") return;

    if (!view.linkable) {
      // Republishing an unchanged view would rebuild the buttons and drop keyboard focus.
      if (view.message !== TAB_ONLY_TEXT) this.#state.publish({ ...view, message: TAB_ONLY_TEXT });

      return;
    }

    this.#state.publish({
      ...view,
      busy: true,
      message: "Anmeldung beim Anbieter wird vorbereitet …",
    });

    try {
      const started = await lease.identities.startLink(providerId);

      if (lease.current()) this.#options.redirect(started.location);
    } catch (error) {
      if (lease.current() && error instanceof Error)
        this.#state.publish({ ...view, busy: false, message: failureText(error) });
    }
  }

  /** Called once the stored session was checked: a link code without that session is dropped. */
  settle(): void {
    if (this.#pending === undefined) return;
    this.#pending = undefined;
    this.#state.publish({
      kind: "hidden",
      message: failureText(new PrivateRequestError("reauth")),
    });
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

      this.#state.publish({
        kind: "ready",
        linked: listed.identities,
        available,
        message: message === "" && !linkable && available.length > 0 ? TAB_ONLY_TEXT : message,
        busy: false,
        linkable,
      });
    } catch (error) {
      if (lease.current() && error instanceof Error)
        this.#state.publish({
          kind: "hidden",
          message: message === "" ? failureText(error) : message,
        });
    }
  }
}
