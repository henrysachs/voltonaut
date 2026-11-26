import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import type { AvatarConfig } from "@voltonaut/shared";

import { PrivateRequestError, type LeaseBinding, type SyncFailure } from "./apiRoute.js";
import { AccountLane } from "./accountLane.js";
import type { AccountScope } from "./accountScope.js";
import { AccountState } from "./accountState.js";
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
  readonly #state: AccountState<GarageLoadoutView, LoadoutLease>;
  /** The newest save or read wins; older answers are dropped. */
  readonly #lane = new AccountLane();

  constructor(scope: AccountScope<LoadoutLease>) {
    this.#state = new AccountState<GarageLoadoutView, LoadoutLease>(
      { kind: "guest" },
      {
        enter: (binding) => ({ kind: binding.kind === "signedIn" ? "loading" : "guest" }),
        start: ({ lease }) => {
          void this.refresh(lease, "");
        },
      },
    );
    this.#state.follow(scope);
  }

  view(): GarageLoadoutView {
    return this.#state.view();
  }

  subscribe(listener: (view: GarageLoadoutView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  /** Rereads equipment that could not be loaded. */
  async retry(): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined || this.#state.view().kind !== "failed") return;
    this.#state.publish({ kind: "loading" });
    await this.refresh(lease, "");
  }

  /** Saves a complete loadout; ignored for guests and while another save is open. */
  async save(loadout: Readonly<AvatarConfig>): Promise<void> {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (lease === undefined || view.kind !== "ready" || view.saving) return;
    const turn = this.#lane.begin(lease);
    this.#state.publish({ ...view, saving: true, message: "Ausrüstung wird gespeichert …" });

    try {
      const saved = await lease.shop.saveLoadout(loadout);

      this.#state.update(turn, () => ({
        kind: "ready",
        loadout: saved.loadout,
        saving: false,
        message: SAVED,
      }));
    } catch (error) {
      if (!turn.current()) return;

      if (error instanceof PrivateRequestError && REJECTIONS.has(error.cause)) {
        await this.refresh(lease, REJECTED);

        return;
      }

      this.#state.publish({ ...view, saving: false, message: UNCONFIRMED });
    }
  }

  private async refresh(lease: LoadoutLease, message: string): Promise<void> {
    const turn = this.#lane.begin(lease);

    try {
      const { loadout } = await lease.shop.loadout();

      this.#state.update(turn, () => ({ kind: "ready", loadout, saving: false, message }));
    } catch {
      this.#state.update(turn, () => ({ kind: "failed", message: UNREACHABLE }));
    }
  }
}
