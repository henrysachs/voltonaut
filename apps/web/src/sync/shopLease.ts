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

/** Volts balance, owned items and atomic purchases of the signed-in account (spec E7-02). */
export interface ShopLease {
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

export type ShopPath = "/v1/me/volts" | "/v1/me/inventory" | "/v1/shop/purchase";

interface ShopSchema<T> {
  readonly parse: (...input: readonly [Parameters<typeof InventoryResponseSchema.parse>[0]]) => T;
}

/** The authorized request of an account lease, restricted to the shop routes. */
export type ShopRequest = <T>(
  path: ShopPath,
  schema: ShopSchema<T>,
  body: string | undefined,
  credentials: "omit" | "include",
) => Promise<T>;

export function shopLease(request: ShopRequest): ShopLease {
  return {
    balance: () => request("/v1/me/volts", VoltsBalanceResponseSchema, undefined, "omit"),
    inventory: () => request("/v1/me/inventory", InventoryResponseSchema, undefined, "omit"),
    async purchase(order) {
      const payload = PurchaseRequestSchema.parse(order);

      const receipt = await request(
        "/v1/shop/purchase",
        PurchaseResponseSchema,
        JSON.stringify(payload),
        "omit",
      );

      if (receipt.item.itemId !== payload.itemId) throw new ShopReceiptMismatch();

      return receipt;
    },
  };
}
