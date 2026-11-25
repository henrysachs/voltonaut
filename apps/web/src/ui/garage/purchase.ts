import type { ItemDef } from "@voltonaut/shared";

import type { GarageShop, GarageShopView } from "../../sync/garageShop.js";
import { purchaseOffer } from "./purchaseOffer.js";

/** The part of the account's shop sync the garage uses. */
export type GarageShopSource = Pick<GarageShop, "subscribe" | "purchase" | "retry">;

/** Purchase button and hint of the garage details; renders only server-confirmed shop state. */
export class GaragePurchase {
  readonly button = document.createElement("button");
  readonly hint = document.createElement("p");
  #item: Readonly<ItemDef> | undefined;
  #view: GarageShopView = { kind: "guest" };
  #source: GarageShopSource | undefined;
  #detach: (() => void) | undefined;

  constructor() {
    this.button.type = "button";
    this.button.className = "garage__purchase";
    this.button.dataset["testid"] = "garage-purchase";
    this.hint.className = "garage__purchase-hint";
    this.hint.dataset["testid"] = "garage-purchase-hint";
    this.hint.setAttribute("aria-live", "polite");
    this.button.addEventListener("click", () => {
      const item = this.#item;

      if (item?.priceVolts !== undefined) void this.#source?.purchase(item.id, item.priceVolts);
    });
  }

  attach(source: GarageShopSource): void {
    this.#detach?.();
    this.#source = source;
    this.#detach = source.subscribe((view) => {
      this.#view = view;
      this.#render();
    });
  }

  show(item: Readonly<ItemDef>, visible: boolean): void {
    this.#item = item;
    this.button.hidden = !visible;
    this.hint.hidden = !visible;

    // Selecting an item after a failed load is the rider asking for the shop again.
    if (this.#view.kind === "failed") void this.#source?.retry();
    this.#render();
  }

  #render(): void {
    if (this.#item === undefined) return;

    const offer = purchaseOffer(this.#item, this.#view);
    this.button.textContent = offer.buttonText;
    this.button.disabled = !offer.enabled;
    this.hint.textContent = offer.hint;
  }
}
