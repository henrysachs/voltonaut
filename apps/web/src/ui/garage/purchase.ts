import type { ItemDef } from "@voltonaut/shared";

import type { GarageShop, GarageShopView } from "../../sync/garageShop.js";
import { purchaseConfirmation, purchaseOffer, type PurchaseConfirmation } from "./purchaseOffer.js";

/** The part of the account's shop sync the garage uses. */
export type GarageShopSource = Pick<GarageShop, "subscribe" | "purchase" | "retry">;

/** The part of the shop sync the purchase controls use; retrying belongs to user selection. */
type PurchaseSource = Pick<GarageShopSource, "subscribe" | "purchase">;

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
  #source: PurchaseSource | undefined;
  #detach: (() => void) | undefined;
  #visible = false;
  /** Open confirmation: the item and the price it showed. */
  #open: { readonly itemId: string; readonly offer: PurchaseConfirmation } | undefined;
  /**
   * The confirmed purchase until the server answers (issue #142). The confirmation stays in place
   * with disabled buttons, so the second click of a double click hits nothing that moved up.
   */
  #buying = false;

  constructor() {
    this.button.setAttribute("class", "btn btn--primary garage__purchase");
    this.button.setAttribute("aria-busy", "false");
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

  attach(source: PurchaseSource): void {
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
    this.#render();
  }

  #buildConfirmation(): void {
    this.confirmation.className = "garage__purchase-confirm";
    this.confirmation.dataset["testid"] = "garage-purchase-confirmation";
    this.confirmation.setAttribute("role", "group");
    // Short group name; the buttons carry the full question as their description.
    this.confirmation.setAttribute("aria-label", "Kauf bestätigen");
    this.confirmation.hidden = true;
    this.#question.id = QUESTION_ID;
    this.#question.className = "garage__purchase-question";
    this.#confirm.setAttribute("class", "btn btn--primary garage__purchase");
    this.#confirm.setAttribute("aria-describedby", QUESTION_ID);
    this.#cancel.setAttribute("class", "btn btn--secondary garage__purchase");
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

    if (open === undefined || this.#buying) return;
    this.#buying = true;
    // The shop marks the purchase pending before its first await; the render below sees it.
    void this.#source?.purchase(open.itemId, open.offer.priceVolts);
    this.#render();
    // The disabled buttons cannot keep focus; the live hint announces the result.
    this.hint.focus();
  }

  /** Ends the in-place pending state once the shop no longer waits for this purchase. */
  #settleBuying(): void {
    const view = this.#view;
    const waiting = view.kind === "ready" && view.pendingItemId === this.#open?.itemId;

    if (!this.#buying || waiting) return;
    this.#buying = false;
    this.#open = undefined;

    if (this.confirmation.contains(document.activeElement)) this.hint.focus();
  }

  #render(): void {
    const item = this.#item;

    if (item === undefined) return;

    const offer = purchaseOffer(item, this.#view);
    const confirmation = purchaseConfirmation(item, this.#view);

    const hadFocus = this.confirmation.contains(document.activeElement);

    this.#settleBuying();

    // The confirmation lives only while the same price is still on offer; the balance text follows the server.
    if (this.#open !== undefined && !this.#buying)
      this.#open =
        confirmation?.priceVolts === this.#open.offer.priceVolts
          ? { itemId: this.#open.itemId, offer: confirmation }
          : undefined;

    const open = this.#open !== undefined && this.#visible;
    this.button.textContent = offer.buttonText;
    this.button.disabled = !offer.enabled;
    this.button.hidden = !this.#visible || open;
    this.hint.hidden = !this.#visible;
    this.confirmation.hidden = !open;
    this.#question.textContent = this.#open?.offer.question ?? "";
    this.#confirm.textContent = this.#buying
      ? "Kauf wird bestätigt …"
      : (this.#open?.offer.confirmText ?? "");
    this.#confirm.disabled = this.#buying;
    this.#confirm.setAttribute("aria-busy", String(this.#buying));
    this.#cancel.disabled = this.#buying;
    const pending = this.#view.kind === "ready" && this.#view.pendingItemId === item.id;
    this.button.setAttribute("aria-busy", String(pending));
    this.hint.textContent = offer.hint;

    // Closed by a view change (logout, failed load, balance): keep keyboard users in place.
    if (hadFocus && this.confirmation.hidden) (offer.enabled ? this.button : this.hint).focus();
  }
}
