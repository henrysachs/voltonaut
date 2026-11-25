import type { StravaConsent, StravaRideView, StravaStatus } from "@voltonaut/shared";
import type { LeaseBinding } from "./apiRoute.js";
import { AccountLane } from "./accountLane.js";
import type { AccountScope } from "./accountScope.js";
import { AccountState } from "./accountState.js";
import { connectStrava, type StravaLease, type StravaPopup } from "./stravaBridge.js";

type Remote<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

export type StravaView =
  | { readonly kind: "guest" }
  | {
      readonly kind: "account";
      readonly userId: string;
      readonly connection: Remote<StravaStatus>;
      readonly ride:
        | { readonly kind: "none" }
        | {
            readonly kind: "selected";
            readonly rideId: string;
            readonly view: Remote<StravaRideView>;
          };
      readonly busy: boolean;
      readonly message: string;
    };

type AccountView = Extract<StravaView, { readonly kind: "account" }>;

export class StravaSync {
  readonly #state: AccountState<StravaView, StravaLease>;
  /** The newest ride selection wins; older status reads are dropped. */
  readonly #selection = new AccountLane();
  #cancelFlow: (() => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    scope: AccountScope<StravaLease>,
    private readonly popup: StravaPopup,
  ) {
    this.#state = new AccountState<StravaView, StravaLease>(
      { kind: "guest" },
      {
        enter: (binding) => {
          this.#cancelFlow?.();
          this.#cancelFlow = undefined;

          if (this.#timer !== undefined) clearTimeout(this.#timer);

          return binding.kind === "signedOut"
            ? { kind: "guest" }
            : {
                kind: "account",
                userId: binding.lease.userId,
                connection: { kind: "loading" },
                ride: { kind: "none" },
                busy: false,
                message: "",
              };
        },
        start: () => {
          void this.refresh();
        },
      },
    );
    this.#state.follow(scope);
  }

  view(): StravaView {
    return this.#state.view();
  }

  subscribe(listener: (view: StravaView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  /** Wraps a rendered control so it does nothing once the account it was rendered for is gone. */
  guard(action: () => void): () => void {
    return this.#state.guard(action);
  }

  private patch(step: Readonly<Pick<LeaseBinding, "current">>, patch: Partial<AccountView>): void {
    this.#state.update(step, (view) => (view.kind === "account" ? { ...view, ...patch } : view));
  }

  connect(): void {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (lease === undefined || !lease.current() || view.kind !== "account" || view.busy) return;
    this.patch(lease, { busy: true, message: "Strava-Fenster wird geöffnet …" });
    this.#cancelFlow = connectStrava(
      lease,
      this.popup,
      (message) => {
        this.patch(lease, { message });
      },
      () => this.refresh(),
      () => {
        this.patch(lease, { busy: false });
      },
    );
  }

  async refresh(): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined || !lease.current()) return;

    try {
      this.patch(lease, { connection: { kind: "ready", value: await lease.strava.status() } });
    } catch {
      this.patch(lease, {
        connection: { kind: "failed" },
        message: "Strava-Status nicht bestätigt. Kein automatischer Login.",
      });
    }

    const view = this.#state.view();

    if (lease.current() && view.kind === "account" && view.ride.kind === "selected")
      await this.select(view.ride.rideId);
  }

  async select(rideId: string): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined || !lease.current()) return;
    const selection = this.#selection.begin(lease);

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.patch(lease, { ride: { kind: "selected", rideId, view: { kind: "loading" } } });

    try {
      const view = await lease.strava.ride(rideId);

      if (!selection.current()) return;
      this.patch(lease, {
        ride: { kind: "selected", rideId, view: { kind: "ready", value: view } },
      });

      if (
        view.kind === "delivery" &&
        view.delivery.authority.kind === "consented" &&
        ["queued", "preparing", "submitting", "processing"].includes(view.delivery.progress.kind)
      )
        this.#timer = setTimeout(() => {
          if (lease.current()) void this.select(rideId);
        }, 3000);
    } catch {
      this.patch(selection, {
        ride: { kind: "selected", rideId, view: { kind: "failed" } },
        message: "Fahrtstatus nicht bestätigt. Nur Status erneut laden, kein neuer Versand.",
      });
    }
  }

  async upload(consent: StravaConsent): Promise<void> {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (
      lease === undefined ||
      !lease.current() ||
      view.kind !== "account" ||
      view.busy ||
      !this.matchesOffer(consent)
    )
      return;
    this.patch(lease, { busy: true, message: "Einmalige Fahrtfreigabe wird gespeichert …" });

    try {
      await lease.strava.upload(consent);

      if (!lease.current()) return;
      this.patch(lease, {
        message: "Freigabe gespeichert. Erst bestätigte Strava-Verarbeitung bedeutet zugestellt.",
      });
    } catch {
      this.patch(lease, {
        message:
          "Auftragsantwort fehlt oder wurde abgelehnt. Nur Status nachladen. Kein automatischer neuer POST.",
      });
    } finally {
      this.patch(lease, { busy: false });
    }

    if (lease.current()) await this.select(consent.rideId);
  }

  private matchesOffer(consent: StravaConsent): boolean {
    const state = this.#state.view();

    return (
      state.kind === "account" &&
      state.ride.kind === "selected" &&
      state.ride.view.kind === "ready" &&
      state.ride.view.value.kind === "offer" &&
      JSON.stringify(state.ride.view.value.consent) === JSON.stringify(consent)
    );
  }

  async disconnect(): Promise<void> {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (lease === undefined || !lease.current() || view.kind !== "account" || view.busy) return;
    this.patch(lease, { busy: true });

    try {
      const connection = await lease.strava.disconnect();
      this.patch(lease, {
        connection: { kind: "ready", value: connection },
        message:
          "Lokal getrennt. Bereits freigegebene Requests oder Aktivitäten werden dadurch nicht zurückgeholt.",
      });
    } catch {
      this.patch(lease, {
        message:
          "Trennantwort nicht bestätigt. Status prüfen; gegebenenfalls Zugriff in Strava-App-Einstellungen entfernen.",
      });
    } finally {
      this.patch(lease, { busy: false });
    }

    if (lease.current()) await this.refresh();
  }

  dispose(): void {
    this.#cancelFlow?.();

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#state.close();
  }
}
