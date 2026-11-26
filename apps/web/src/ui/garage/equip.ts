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
    this.#hint.tabIndex = -1;
    this.#equip.addEventListener("click", handlers.equip);
    this.#discard.addEventListener("click", handlers.discard);
    this.root.append(this.#equip, this.#discard, this.#hint);
  }

  render(offer: Readonly<EquipOffer>): void {
    const focused =
      document.activeElement === this.#equip
        ? "equip"
        : document.activeElement === this.#discard
          ? "discard"
          : "none";

    this.#equip.hidden = !offer.visible;
    this.#equip.textContent = offer.equipText;
    this.#equip.disabled = !offer.equipEnabled;
    // Only next to „Ausrüsten“: a lone discard button would sit where the purchase flow just was.
    this.#discard.hidden = !offer.visible || !offer.discardEnabled;
    this.#hint.hidden = offer.hint === "";
    this.#hint.textContent = offer.hint;

    // A save disables „Ausrüsten“ and a discard hides its button: keep keyboard users in place.
    const equipUsable = !this.#equip.hidden && !this.#equip.disabled;

    const lost =
      (focused === "equip" && !equipUsable) || (focused === "discard" && this.#discard.hidden);

    if (!lost) return;

    if (equipUsable) this.#equip.focus();
    else if (this.#discard.hidden) {
      this.#hint.hidden = false;
      this.#hint.focus();
    } else this.#discard.focus();
  }
}
