import {
  InventoryResponseSchema,
  LoadoutResponseSchema,
  LoadoutUpdateSchema,
  PurchaseRequestSchema,
  PurchaseResponseSchema,
  VoltsBalanceResponseSchema,
  type AvatarConfig,
  type InventoryResponse,
  type LoadoutResponse,
  type PurchaseOrder,
  type PurchaseResponse,
  type VoltsBalanceResponse,
} from "@voltonaut/shared";
import { privateRoute, type PrivateSend } from "./apiRoute.js";

/** Volts balance, owned items and atomic purchases of the signed-in account (spec E7-02). */
export interface ShopPort {
  readonly balance: () => Promise<VoltsBalanceResponse>;
  readonly inventory: () => Promise<InventoryResponse>;
  readonly purchase: (order: Readonly<PurchaseOrder>) => Promise<PurchaseResponse>;
  /** Stored equipment or the default (spec E7-05). */
  readonly loadout: () => Promise<LoadoutResponse>;
  readonly saveLoadout: (loadout: Readonly<AvatarConfig>) => Promise<LoadoutResponse>;
}

/** The server confirmed a purchase of another item than the order named; a final, non-retryable answer. */
export class ShopReceiptMismatch extends Error {
  constructor() {
    super("Purchase receipt mismatch");
  }
}

export const shopRoutes = {
  balance: privateRoute({
    method: "GET",
    path: () => "/v1/me/volts",
    response: VoltsBalanceResponseSchema,
    credentials: "omit",
  }),
  inventory: privateRoute({
    method: "GET",
    path: () => "/v1/me/inventory",
    response: InventoryResponseSchema,
    credentials: "omit",
  }),
  purchase: privateRoute({
    method: "POST",
    path: () => "/v1/shop/purchase",
    body: (order: Readonly<PurchaseOrder>) => JSON.stringify(PurchaseRequestSchema.parse(order)),
    response: PurchaseResponseSchema,
    credentials: "omit",
  }),
  loadout: privateRoute({
    method: "GET",
    path: () => "/v1/me/loadout",
    response: LoadoutResponseSchema,
    credentials: "omit",
  }),
  saveLoadout: privateRoute({
    method: "PUT",
    path: () => "/v1/me/loadout",
    body: (loadout: Readonly<AvatarConfig>) =>
      JSON.stringify(LoadoutUpdateSchema.parse({ loadout })),
    response: LoadoutResponseSchema,
    credentials: "omit",
  }),
};

export function shopPort(send: PrivateSend): ShopPort {
  return {
    balance: () => send(shopRoutes.balance, null),
    inventory: () => send(shopRoutes.inventory, null),
    loadout: () => send(shopRoutes.loadout, null),
    saveLoadout: (loadout) => send(shopRoutes.saveLoadout, loadout),
    async purchase(order) {
      const payload = PurchaseRequestSchema.parse(order);
      const receipt = await send(shopRoutes.purchase, payload);

      if (receipt.item.itemId !== payload.itemId) throw new ShopReceiptMismatch();

      return receipt;
    },
  };
}
