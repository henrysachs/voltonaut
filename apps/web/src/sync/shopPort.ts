import {
  InventoryResponseSchema,
  PurchaseRequestSchema,
  PurchaseResponseSchema,
  VoltsBalanceResponseSchema,
  type InventoryResponse,
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
};

export function shopPort(send: PrivateSend): ShopPort {
  return {
    balance: () => send(shopRoutes.balance, null),
    inventory: () => send(shopRoutes.inventory, null),
    async purchase(order) {
      const payload = PurchaseRequestSchema.parse(order);
      const receipt = await send(shopRoutes.purchase, payload);

      if (receipt.item.itemId !== payload.itemId) throw new ShopReceiptMismatch();

      return receipt;
    },
  };
}
