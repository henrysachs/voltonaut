import type { ItemDef } from "@voltonaut/shared";

import type { GarageShopView } from "../../sync/garageShop.js";

const VOLTS_FORMAT = new Intl.NumberFormat("de-DE");

export interface PurchaseOffer {
  readonly buttonText: string;
  readonly enabled: boolean;
  readonly hint: string;
}

function volts(amount: number): string {
  return `${VOLTS_FORMAT.format(amount)} ⚡`;
}

function offline(
  item: Readonly<ItemDef>,
  view: Exclude<GarageShopView, { readonly kind: "ready" }>,
): PurchaseOffer {
  const buttonText = item.priceVolts === undefined ? "Nicht käuflich" : "Kauf nicht verfügbar";

  switch (view.kind) {
    case "guest":
      return { buttonText, enabled: false, hint: "Zum Kaufen anmelden. Bis dahin nur Vorschau." };
    case "loading":
      return { buttonText, enabled: false, hint: "Besitz und Volts werden geladen …" };
    case "failed":
      return { buttonText, enabled: false, hint: view.message };
    default: {
      const exhaustive: never = view;
      throw new Error(`Unsupported shop view: ${String(exhaustive)}`);
    }
  }
}

/**
 * What the garage may offer for one item, from the server-confirmed shop view (spec E7-02 AK8).
 * Level requirements are not checked yet; the server sells every shop item (transition).
 */
export function purchaseOffer(item: Readonly<ItemDef>, view: GarageShopView): PurchaseOffer {
  if (view.kind !== "ready") return offline(item, view);

  const own = view.messageItemId === null || view.messageItemId === item.id;
  const note = own ? view.message : "";
  const message = note === "" ? "" : ` ${note}`;

  if (view.ownedItemIds.includes(item.id))
    return { buttonText: "Im Besitz", enabled: false, hint: `Gehört deinem Konto.${message}` };

  if (item.unlock.kind !== "shop" || item.priceVolts === undefined)
    return { buttonText: "Nicht käuflich", enabled: false, hint: note };

  const price = item.priceVolts;

  if (view.pendingItemId !== null)
    return { buttonText: `Kaufen (${volts(price)})`, enabled: false, hint: note };

  if (view.voltsBalance < price)
    return {
      buttonText: `Kaufen (${volts(price)})`,
      enabled: false,
      hint: `Zu wenig Volts: ${volts(view.voltsBalance)} vorhanden.${message}`,
    };

  return {
    buttonText: `Kaufen (${volts(price)})`,
    enabled: true,
    hint: `Guthaben: ${volts(view.voltsBalance)}.${message}`,
  };
}
