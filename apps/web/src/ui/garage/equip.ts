import { garageButton } from "./garageItems.js";
import type { EquipOffer } from "./equipOffer.js";

/** „Ausrüsten“, „Vorschau verwerfen“ and the loadout hint of the garage details (spec E7-05). */
export class GarageEquip {
  readonly root = document.createElement("div");
  readonly #equip = garageButton("Ausrüsten");
  readonly #discard = garageButton("Vorschau verwerfen");
  readonly #hint = document.createElement("p");

  constructor(handlers: Readonly<{ equip: () => void; discard: () => void }>) {
    this.root.className = "garage__equip";
    this.#equip.className = "garage__purchase";
    this.#equip.dataset["testid"] = "garage-equip";
    this.#discard.className = "garage__purchase";
    this.#discard.dataset["testid"] = "garage-discard";
    this.#hint.className = "garage__purchase-hint";
    this.#hint.dataset["testid"] = "garage-equip-hint";
    this.#hint.setAttribute("aria-live", "polite");
    this.#equip.addEventListener("click", handlers.equip);
    this.#discard.addEventListener("click", handlers.discard);
    this.root.append(this.#equip, this.#discard, this.#hint);
  }

  render(offer: Readonly<EquipOffer>, visible: boolean): void {
    this.#equip.hidden = !offer.visible || !visible;
    this.#equip.textContent = offer.equipText;
    this.#equip.disabled = !offer.equipEnabled;
    this.#discard.hidden = !offer.discardEnabled;
    this.#hint.hidden = !visible || offer.hint === "";
    this.#hint.textContent = offer.hint;
  }
}
