import {
  PrivateRequestError,
  type AccountLease,
  type SyncFailure,
} from "./privateAuthTransport.js";
import { ShopReceiptMismatch } from "./shopLease.js";

export type GarageShopView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly voltsBalance: number;
      readonly ownedItemIds: readonly string[];
      /** Item whose purchase is waiting for the server; at most one at a time. */
      readonly pendingItemId: string | null;
      readonly message: string;
      /** Item the message is about; `null` for messages about the whole shop. */
      readonly messageItemId: string | null;
    };

type ReadyView = Extract<GarageShopView, { readonly kind: "ready" }>;

const UNREACHABLE = "Shop nicht erreichbar. Besitz und Volts nicht bestätigt.";

const REJECTED =
  "Kauf abgelehnt: Preis, Besitz oder Guthaben passt nicht mehr. Serverstand neu gelesen.";

const BOUGHT = "Gekauft. Das Item gehört jetzt zu deinem Konto.";

/** Final server answers: the same request can never succeed, so a retry needs a new id. */
const REJECTIONS: ReadonlySet<SyncFailure> = new Set([
  "conflict",
  "missing",
  "forbidden",
  "contract",
]);

const UNCONFIRMED =
  "Kauf nicht bestätigt. Ein neuer Versuch nutzt dieselbe Anfrage, ohne doppelte Abbuchung.";

/**
 * Server-confirmed Volts balance and inventory for the garage (spec E7-02 AK8).
 * Owns no authoritative state: every value comes from the account's server.
 */
export class GarageShop {
  readonly #listeners = new Set<(view: GarageShopView) => void>();
  /** Unconfirmed purchases keep their request id so a retry cannot charge twice. */
  readonly #retryIds = new Map<string, string>();
  readonly #newRequestId: () => string;
  #view: GarageShopView = { kind: "guest" };
  #lease: AccountLease | undefined;
  #retryUserId: string | undefined;
  #revision = 0;

  constructor(newRequestId: () => string = () => crypto.randomUUID()) {
    this.#newRequestId = newRequestId;
  }

  bind(lease?: AccountLease): void {
    this.#lease = lease;

    // A re-authenticated session of the same account keeps open request ids (ADR-031 §3). The
    // session passes through a signed-out state on the way, so only another account clears them.
    if (lease !== undefined) {
      if (lease.userId !== this.#retryUserId) this.#retryIds.clear();
      this.#retryUserId = lease.userId;
    }

    this.#revision += 1;
    this.publish({ kind: lease === undefined ? "guest" : "loading" });

    if (lease !== undefined) void this.refresh(lease, "", null);
  }

  /** Rereads a shop that could not be loaded, e.g. when the browser is back online. */
  async retry(): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined || this.#view.kind !== "failed") return;
    this.publish({ kind: "loading" });
    await this.refresh(lease, "", null);
  }

  view(): GarageShopView {
    return this.#view;
  }

  subscribe(listener: (view: GarageShopView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Buys one item at the price the garage shows; ignored while another purchase is open. */
  async purchase(itemId: string, priceVolts: number): Promise<void> {
    const lease = this.#lease;
    const view = this.#view;

    if (lease === undefined || view.kind !== "ready" || view.pendingItemId !== null) return;
    const requestId = this.#retryIds.get(itemId) ?? this.#newRequestId();
    const revision = ++this.#revision;
    this.#retryIds.set(itemId, requestId);
    this.publish({
      ...view,
      pendingItemId: itemId,
      message: "Kauf wird bestätigt …",
      messageItemId: itemId,
    });

    try {
      const receipt = await lease.shop.purchase({
        requestId,
        itemId,
        expectedPriceVolts: priceVolts,
      });

      if (!this.current(lease, revision)) return;
      this.#retryIds.delete(itemId);

      // An earlier unconfirmed purchase may have committed; reread instead of mixing states.
      if (this.#retryIds.size > 0) {
        await this.refresh(lease, BOUGHT, itemId);

        return;
      }

      this.publish({
        kind: "ready",
        voltsBalance: receipt.voltsBalance,
        ownedItemIds: [...new Set([...view.ownedItemIds, receipt.item.itemId])],
        pendingItemId: null,
        message: BOUGHT,
        messageItemId: itemId,
      });
    } catch (error) {
      const rejected =
        error instanceof ShopReceiptMismatch ||
        (error instanceof PrivateRequestError && REJECTIONS.has(error.cause));

      if (this.current(lease, revision)) await this.failPurchase(lease, view, itemId, rejected);
    }
  }

  private async failPurchase(
    lease: AccountLease,
    view: ReadyView,
    itemId: string,
    rejected: boolean,
  ): Promise<void> {
    if (rejected) {
      this.#retryIds.delete(itemId);
      await this.refresh(lease, REJECTED, itemId);

      return;
    }

    this.publish({ ...view, pendingItemId: null, message: UNCONFIRMED, messageItemId: itemId });
  }

  private current(lease: AccountLease, revision: number): boolean {
    return this.#lease === lease && lease.current() && revision === this.#revision;
  }

  private publish(view: GarageShopView): void {
    this.#view = view;

    for (const listener of this.#listeners) listener(view);
  }

  private async refresh(
    lease: AccountLease,
    message: string,
    messageItemId: string | null,
  ): Promise<void> {
    const revision = ++this.#revision;

    try {
      const [balance, inventory] = await Promise.all([
        lease.shop.balance(),
        lease.shop.inventory(),
      ]);

      if (!this.current(lease, revision)) return;

      const ownedItemIds = inventory.items.map(({ itemId }) => itemId);

      for (const itemId of ownedItemIds) this.#retryIds.delete(itemId);
      this.publish({
        kind: "ready",
        voltsBalance: balance.voltsBalance,
        ownedItemIds,
        pendingItemId: null,
        message,
        messageItemId,
      });
    } catch {
      if (this.current(lease, revision)) this.publish({ kind: "failed", message: UNREACHABLE });
    }
  }
}
