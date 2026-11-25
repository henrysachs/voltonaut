import type { ItemDef } from "@voltonaut/shared";

import type { GarageShop, GarageShopView } from "../../sync/garageShop.js";
import { purchaseConfirmation, purchaseOffer, type PurchaseConfirmation } from "./purchaseOffer.js";

/** The part of the account's shop sync the garage uses. */
export type GarageShopSource = Pick<GarageShop, "subscribe" | "purchase" | "retry">;

const QUESTION_ID = "garage-purchase-question";

function actionButton(text: string, testId: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.dataset["testid"] = testId;

  return element;
}

/**
 * Purchase button, two-step confirmation and hint of the garage details (issue #115).
 * Renders only server-confirmed shop state; a single click never spends Volts.
 */
export class GaragePurchase {
  readonly button = actionButton("", "garage-purchase");
  readonly confirmation = document.createElement("div");
  readonly hint = document.createElement("p");
  readonly #question = document.createElement("p");
  readonly #confirm = actionButton("", "garage-purchase-confirm");
  readonly #cancel = actionButton("Abbrechen", "garage-purchase-cancel");
  #item: Readonly<ItemDef> | undefined;
  #view: GarageShopView = { kind: "guest" };
  #source: GarageShopSource | undefined;
  #detach: (() => void) | undefined;
  #visible = false;
  /** Open confirmation: the item and the price it showed. */
  #open: { readonly itemId: string; readonly offer: PurchaseConfirmation } | undefined;

  constructor() {
    this.button.className = "garage__purchase";
    this.hint.className = "garage__purchase-hint";
    this.hint.dataset["testid"] = "garage-purchase-hint";
    this.hint.setAttribute("aria-live", "polite");
    this.hint.tabIndex = -1;
    this.#buildConfirmation();
    this.button.addEventListener("click", () => {
      this.#openConfirmation();
    });
    this.#cancel.addEventListener("click", () => {
      this.#close(this.button);
    });
    this.#confirm.addEventListener("click", () => {
      this.#buy();
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
    if (this.#item?.id !== item.id) this.#open = undefined;
    this.#item = item;
    this.#visible = visible;

    // Selecting an item after a failed load is the rider asking for the shop again.
    if (this.#view.kind === "failed") void this.#source?.retry();
    this.#render();
  }

  #buildConfirmation(): void {
    this.confirmation.className = "garage__purchase-confirm";
    this.confirmation.dataset["testid"] = "garage-purchase-confirmation";
    this.confirmation.setAttribute("role", "group");
    this.confirmation.setAttribute("aria-labelledby", QUESTION_ID);
    this.confirmation.hidden = true;
    this.#question.id = QUESTION_ID;
    this.#question.className = "garage__purchase-question";
    this.#confirm.className = "garage__purchase";
    this.#confirm.setAttribute("aria-describedby", QUESTION_ID);
    this.#cancel.className = "garage__purchase";
    this.#cancel.setAttribute("aria-describedby", QUESTION_ID);
    this.confirmation.append(this.#question, this.#confirm, this.#cancel);
  }

  #openConfirmation(): void {
    const item = this.#item;
    const offer = item === undefined ? null : purchaseConfirmation(item, this.#view);

    if (item === undefined || offer === null) return;
    this.#open = { itemId: item.id, offer };
    this.#render();
    // Focus „Abbrechen“: a held or repeated Enter must never confirm the purchase.
    this.#cancel.focus();
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Focus moves to a live DOM element.
  #close(focus: HTMLElement): void {
    this.#open = undefined;
    this.#render();
    focus.focus();
  }

  #buy(): void {
    const open = this.#open;

    if (open === undefined) return;
    this.#close(this.hint);
    void this.#source?.purchase(open.itemId, open.offer.priceVolts);
  }

  #render(): void {
    const item = this.#item;

    if (item === undefined) return;

    const offer = purchaseOffer(item, this.#view);
    const confirmation = purchaseConfirmation(item, this.#view);

    // The confirmation lives only while the same price is still on offer.
    if (confirmation?.priceVolts !== this.#open?.offer.priceVolts) this.#open = undefined;

    const open = this.#open !== undefined && this.#visible;
    this.button.textContent = offer.buttonText;
    this.button.disabled = !offer.enabled;
    this.button.hidden = !this.#visible || open;
    this.hint.hidden = !this.#visible;
    this.confirmation.hidden = !open;
    this.#question.textContent = this.#open?.offer.question ?? "";
    this.#confirm.textContent = this.#open?.offer.confirmText ?? "";
    this.hint.textContent = offer.hint;
  }
}
