import type { StravaConsent, StravaRideView, StravaStatus } from "@voltonaut/shared";
import type { ApplicationSession } from "./applicationSession.js";
import type { AccountLease } from "./privateAuthTransport.js";
import { connectStrava } from "./stravaBridge.js";
import type { StravaPopup } from "./stravaBridge.js";

type Remote<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

export type StravaView =
  | { readonly kind: "guest" }
  | {
      readonly kind: "account";
      readonly userId: string;
      readonly generation: number;
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

export class StravaSync {
  readonly #listeners = new Set<(view: StravaView) => void>();
  #view: StravaView = { kind: "guest" };
  #lease: AccountLease | undefined;
  #cancelFlow: (() => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #selection = 0;
  readonly #unsubscribe: () => void;

  constructor(
    session: Readonly<Pick<ApplicationSession, "authorize" | "subscribe">>,
    private readonly popup: StravaPopup,
  ) {
    this.#unsubscribe = session.subscribe((view) => {
      this.#cancelFlow?.();
      this.#cancelFlow = undefined;

      if (this.#timer !== undefined) clearTimeout(this.#timer);
      this.#selection += 1;
      this.#lease = view.kind === "authenticated" ? session.authorize() : undefined;
      const lease = this.#lease;
      this.publish(
        lease === undefined
          ? { kind: "guest" }
          : {
              kind: "account",
              userId: lease.userId,
              generation: lease.generation,
              connection: { kind: "loading" },
              ride: { kind: "none" },
              busy: false,
              message: "",
            },
      );

      if (lease !== undefined) void this.refresh();
    });
  }

  view(): StravaView {
    return this.#view;
  }
  subscribe(listener: (view: StravaView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }
  private publish(view: StravaView): void {
    this.#view = view;

    for (const listener of this.#listeners) listener(view);
  }
  private patch(
    lease: AccountLease,
    patch: Partial<Extract<StravaView, { readonly kind: "account" }>>,
  ): void {
    if (lease.current() && this.#lease === lease && this.#view.kind === "account")
      this.publish({ ...this.#view, ...patch });
  }

  connect(): void {
    const lease = this.#lease;

    if (lease === undefined || !lease.current() || this.#view.kind !== "account" || this.#view.busy)
      return;
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
    const lease = this.#lease;

    if (lease === undefined || !lease.current()) return;

    try {
      this.patch(lease, { connection: { kind: "ready", value: await lease.strava.status() } });
    } catch {
      this.patch(lease, {
        connection: { kind: "failed" },
        message: "Strava-Status nicht bestätigt. Kein automatischer Login.",
      });
    }

    if (
      this.#lease === lease &&
      lease.current() &&
      this.#view.kind === "account" &&
      this.#view.ride.kind === "selected"
    )
      await this.select(this.#view.ride.rideId);
  }

  async select(rideId: string): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined || !lease.current()) return;
    const selection = ++this.#selection;

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.patch(lease, { ride: { kind: "selected", rideId, view: { kind: "loading" } } });

    try {
      const view = await lease.strava.ride(rideId);

      if (selection !== this.#selection || !lease.current() || this.#lease !== lease) return;
      this.patch(lease, {
        ride: { kind: "selected", rideId, view: { kind: "ready", value: view } },
      });

      if (
        view.kind === "delivery" &&
        view.delivery.authority.kind === "consented" &&
        ["queued", "preparing", "submitting", "processing"].includes(view.delivery.progress.kind)
      )
        this.#timer = setTimeout(() => {
          if (lease.current() && this.#lease === lease) void this.select(rideId);
        }, 3000);
    } catch {
      if (selection === this.#selection)
        this.patch(lease, {
          ride: { kind: "selected", rideId, view: { kind: "failed" } },
          message: "Fahrtstatus nicht bestätigt. Nur Status erneut laden, kein neuer Versand.",
        });
    }
  }

  async upload(consent: StravaConsent): Promise<void> {
    const lease = this.#lease;

    if (
      lease === undefined ||
      !lease.current() ||
      this.#view.kind !== "account" ||
      this.#view.busy ||
      !this.matchesOffer(consent)
    )
      return;
    this.patch(lease, { busy: true, message: "Einmalige Fahrtfreigabe wird gespeichert …" });

    try {
      await lease.strava.upload(consent);

      if (!lease.current() || this.#lease !== lease) return;
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

    if (lease.current() && this.#lease === lease) await this.select(consent.rideId);
  }

  private matchesOffer(consent: StravaConsent): boolean {
    const state = this.#view;

    return (
      state.kind === "account" &&
      state.ride.kind === "selected" &&
      state.ride.view.kind === "ready" &&
      state.ride.view.value.kind === "offer" &&
      JSON.stringify(state.ride.view.value.consent) === JSON.stringify(consent)
    );
  }

  async disconnect(): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined || !lease.current() || this.#view.kind !== "account" || this.#view.busy)
      return;
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

    if (lease.current() && this.#lease === lease) await this.refresh();
  }

  dispose(): void {
    this.#unsubscribe();
    this.#cancelFlow?.();

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#listeners.clear();
  }
}
