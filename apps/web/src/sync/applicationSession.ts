import type { SessionResponse, User } from "@voltonaut/shared";

import type { AuthTransport } from "./authTransport.js";
import type { SessionPersistence } from "./sessionPersistence.js";
import type { AccountLease, PrivateAuthTransport } from "./privateAuthTransport.js";

export type SessionView =
  | { readonly kind: "guest"; readonly message: string }
  | { readonly kind: "busy"; readonly operation: "restoring" | "exchanging" | "login" }
  | { readonly kind: "authenticated"; readonly user: Readonly<User>; readonly persistent: boolean };

type SessionState =
  | Extract<SessionView, { readonly kind: "guest" }>
  | { readonly kind: "restoring"; readonly token: string }
  | { readonly kind: "busy"; readonly operation: "exchanging" | "login" }
  | {
      readonly kind: "authenticated";
      readonly session: SessionResponse;
      readonly persistent: boolean;
    };

interface SessionOptions {
  readonly transport: AuthTransport;
  readonly persistence: SessionPersistence;
  readonly navigate: () => void;
  readonly privateTransport: PrivateAuthTransport;
}

export class ApplicationSession {
  readonly #options: SessionOptions;
  readonly #listeners = new Set<(view: SessionView) => void>();
  #state: SessionState = { kind: "guest", message: "Gast. Fahren ohne Anmeldung möglich." };
  #generation = 0;
  #controller = new AbortController();

  constructor(options: SessionOptions) {
    this.#options = options;
  }

  authorize(): AccountLease | undefined {
    if (this.#state.kind !== "authenticated") return undefined;
    const generation = this.#generation;

    return this.#options.privateTransport.authorize({
      token: this.#state.session.sessionToken,
      userId: this.#state.session.user.id,
      generation,
      signal: this.#controller.signal,
      current: () => generation === this.#generation && this.#state.kind === "authenticated",
    });
  }

  view(): SessionView {
    const state = this.#state;

    if (state.kind === "restoring") return { kind: "busy", operation: "restoring" };

    if (state.kind === "authenticated")
      return { kind: "authenticated", user: state.session.user, persistent: state.persistent };

    return state;
  }

  subscribe(listener: (view: SessionView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.view());

    return () => {
      this.#listeners.delete(listener);
    };
  }

  private publish(state: SessionState): void {
    this.#state = state;
    const view = this.view();

    for (const listener of this.#listeners) listener(view);
  }

  private begin() {
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#generation += 1;

    return {
      generation: this.#generation,
      signal: AbortSignal.any([this.#controller.signal, AbortSignal.timeout(8000)]),
    };
  }

  async restore(): Promise<void> {
    if (this.#state.kind !== "guest") return;
    const token = this.#options.persistence.load();

    if (token === undefined) return;
    const operation = this.begin();
    this.publish({ kind: "restoring", token });

    try {
      const user = await this.#options.transport.me(token, operation.signal);

      if (operation.generation !== this.#generation) return;
      this.publish({
        kind: "authenticated",
        session: { user, sessionToken: token },
        persistent: true,
      });
    } catch {
      if (operation.generation !== this.#generation) return;
      this.#options.persistence.clear();
      this.publish({ kind: "guest", message: "Session nicht bestätigt. Weiter als Gast." });
    }
  }

  async exchange(code: string): Promise<void> {
    const operation = this.begin();
    this.#options.persistence.clear();
    this.publish({ kind: "busy", operation: "exchanging" });

    try {
      const session = await this.#options.transport.exchange(code, operation.signal);

      if (operation.generation !== this.#generation) return;
      const persistent = this.#options.persistence.save(session.sessionToken);
      this.publish({ kind: "authenticated", session, persistent });
    } catch {
      if (operation.generation !== this.#generation) return;
      this.publish({
        kind: "guest",
        message: "Anmeldung fehlgeschlagen oder Übergabe abgelaufen. Bei Bedarf erneut anmelden.",
      });
    }
  }

  async login(): Promise<void> {
    if (this.#state.kind !== "guest") return;
    const operation = this.begin();
    this.publish({ kind: "busy", operation: "login" });

    try {
      const config = await this.#options.transport.mode(operation.signal);

      if (operation.generation !== this.#generation) return;

      if (config.mode === "oidc") {
        this.#options.navigate();
        this.publish({ kind: "guest", message: "Gast. Anmeldung bei Bedarf erneut starten." });
      } else {
        this.publish({
          kind: "guest",
          message:
            config.mode === "disabled"
              ? "Anmeldung ist auf diesem Server deaktiviert."
              : "Dieser Server verwendet noch den alten Mail-Login. Hier nicht unterstützt.",
        });
      }
    } catch {
      if (operation.generation !== this.#generation) return;
      this.publish({
        kind: "guest",
        message: "Anmeldeserver nicht erreichbar. Gastbetrieb bleibt möglich.",
      });
    }
  }

  public endAfterAccountDeletion(): void {
    this.begin();
    const cleared = this.#options.persistence.clear();
    this.publish({
      kind: "guest",
      message: cleared
        ? "Konto gelöscht. Lokale Session entfernt; Aufräumarbeiten laufen."
        : "Konto gelöscht. Lokale Session konnte nicht entfernt werden; Browserdaten prüfen.",
    });
  }

  async logout(): Promise<void> {
    const state = this.#state;

    const token =
      state.kind === "authenticated"
        ? state.session.sessionToken
        : state.kind === "restoring"
          ? state.token
          : undefined;

    const operation = this.begin();
    const cleared = this.#options.persistence.clear();
    this.publish({ kind: "guest", message: "Im Tab abgemeldet. Serverwiderruf wird geprüft …" });

    if (token === undefined) {
      this.publish({
        kind: "guest",
        message: cleared
          ? "Lokal abgemeldet. Keine bestätigte Session zum Widerrufen."
          : "Im Tab abgemeldet. Keine bestätigte Session; Speicherbereinigung nicht bestätigt.",
      });

      return;
    }

    try {
      await this.#options.transport.logout(token, operation.signal);

      if (operation.generation !== this.#generation) return;
      this.publish({
        kind: "guest",
        message: cleared
          ? "Abgemeldet. Voltonaut-Session beendet; Anbieter-Anmeldung bleibt bestehen."
          : "Im Tab abgemeldet. Lokaler Speicher konnte nicht bereinigt werden; Browserdaten prüfen.",
      });
    } catch {
      if (operation.generation !== this.#generation) return;
      this.publish({
        kind: "guest",
        message: cleared
          ? "Lokal abgemeldet. Serverwiderruf nicht bestätigt."
          : "Im Tab abgemeldet. Serverwiderruf und Speicherbereinigung nicht bestätigt.",
      });
    }
  }
}
