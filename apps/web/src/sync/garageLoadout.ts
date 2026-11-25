import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import type { AvatarConfig } from "@voltonaut/shared";

import { PrivateRequestError, type LeaseBinding, type SyncFailure } from "./apiRoute.js";
import type { ShopPort } from "./shopPort.js";

/** Reading and saving the equipment goes through the shop port only. */
export type LoadoutLease = LeaseBinding & {
  readonly shop: Pick<ShopPort, "loadout" | "saveLoadout">;
};

export type GarageLoadoutView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      /** Server-confirmed equipment; the garage shows previews on top of it. */
      readonly loadout: AvatarConfig;
      readonly saving: boolean;
      readonly message: string;
    };

const UNREACHABLE = "Ausrüstung nicht erreichbar. Fahrt nutzt die Standardausrüstung.";

const SAVED = "Ausgerüstet. Gilt in der Fahrt und auf jedem Gerät.";

const REJECTED =
  "Ausrüsten abgelehnt: Item nicht im Besitz oder Farbe nicht erlaubt. Serverstand neu gelesen.";

const UNCONFIRMED = "Ausrüstung nicht bestätigt. Bitte erneut versuchen.";

/** 409 `not_owned` and 422 for foreign colors or items: the same loadout can never succeed. */
const REJECTIONS: ReadonlySet<SyncFailure> = new Set(["conflict", "contract", "forbidden"]);

/** The equipment a rider wears: server-confirmed when signed in, the catalog default otherwise. */
export function wornLoadout(view: GarageLoadoutView): AvatarConfig {
  return view.kind === "ready" ? view.loadout : DEFAULT_AVATAR_CONFIG;
}

/**
 * Server-confirmed equipment for garage and ride (spec E7-05 AK6). Owns no authoritative state;
 * one save at a time, and a rejected save rereads the server.
 */
export class GarageLoadout {
  readonly #listeners = new Set<(view: GarageLoadoutView) => void>();
  #view: GarageLoadoutView = { kind: "guest" };
  #lease: LoadoutLease | undefined;
  #revision = 0;

  bind(lease?: LoadoutLease): void {
    this.#lease = lease;
    this.#revision += 1;
    this.publish({ kind: lease === undefined ? "guest" : "loading" });

    if (lease !== undefined) void this.refresh(lease, "");
  }

  view(): GarageLoadoutView {
    return this.#view;
  }

  subscribe(listener: (view: GarageLoadoutView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Rereads equipment that could not be loaded. */
  async retry(): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined || this.#view.kind !== "failed") return;
    this.publish({ kind: "loading" });
    await this.refresh(lease, "");
  }

  /** Saves a complete loadout; ignored for guests and while another save is open. */
  async save(loadout: Readonly<AvatarConfig>): Promise<void> {
    const lease = this.#lease;
    const view = this.#view;

    if (lease === undefined || view.kind !== "ready" || view.saving) return;
    const revision = ++this.#revision;
    this.publish({ ...view, saving: true, message: "Ausrüstung wird gespeichert …" });

    try {
      const saved = await lease.shop.saveLoadout(loadout);

      if (this.current(lease, revision))
        this.publish({ kind: "ready", loadout: saved.loadout, saving: false, message: SAVED });
    } catch (error) {
      if (!this.current(lease, revision)) return;

      if (error instanceof PrivateRequestError && REJECTIONS.has(error.cause)) {
        await this.refresh(lease, REJECTED);

        return;
      }

      this.publish({ ...view, saving: false, message: UNCONFIRMED });
    }
  }

  private current(lease: LoadoutLease, revision: number): boolean {
    return this.#lease === lease && lease.current() && revision === this.#revision;
  }

  private publish(view: GarageLoadoutView): void {
    this.#view = view;

    for (const listener of this.#listeners) listener(view);
  }

  private async refresh(lease: LoadoutLease, message: string): Promise<void> {
    const revision = ++this.#revision;

    try {
      const { loadout } = await lease.shop.loadout();

      if (this.current(lease, revision))
        this.publish({ kind: "ready", loadout, saving: false, message });
    } catch {
      if (this.current(lease, revision)) this.publish({ kind: "failed", message: UNREACHABLE });
    }
  }
}
