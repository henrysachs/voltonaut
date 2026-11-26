import { AVATAR_SLOTS, avatarItemsForSlot } from "@voltonaut/rules";
import type { ItemDef } from "@voltonaut/shared";

import { button as createButton } from "../button.js";
import { itemUnlockText, priceText, rarityText, slotText } from "./garageText.js";
import { previewColorOptions } from "./palettes.js";
import { GaragePurchase, type GarageShopSource } from "./purchase.js";
import { createGaragePreviewView, type GaragePreviewView } from "./preview.js";
import {
  createInitialGarageState,
  garageReducer,
  type GarageAction,
  type GarageState,
} from "./state.js";

function button(text: string): HTMLButtonElement {
  const element = createButton(text);
  element.setAttribute("class", "btn btn--secondary");

  return element;
}

class GaragePanel {
  readonly #slotHost = document.createElement("div");
  readonly #browseSection = document.createElement("section");
  readonly #itemHost = document.createElement("ul");
  readonly #previewHost = document.createElement("div");
  readonly #previewNote = document.createElement("p");
  readonly #itemName = document.createElement("h3");
  readonly #itemMeta = document.createElement("p");
  readonly #price = document.createElement("p");
  readonly #colors = document.createElement("fieldset");
  readonly #purchase = new GaragePurchase();
  readonly #rotateLeft = button("Links drehen");
  readonly #rotateRight = button("Rechts drehen");
  readonly #rotateToggle = button("Drehung pausieren");
  readonly #root = document.createElement("div");
  #state: GarageState;
  #preview: GaragePreviewView | null = null;
  #autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The panel owns the host's menu children.
    private readonly host: HTMLElement,
    wheelCircM: number,
  ) {
    this.#state = createInitialGarageState();
    this.#build();
    this.#preview = createGaragePreviewView(this.#previewHost, wheelCircM);

    if (this.#preview === null) {
      this.#state = garageReducer(this.#state, { kind: "previewUnavailable" });
    } else {
      this.#preview.setLook(this.#state.config);
      this.#preview.setAutoRotate(this.#autoRotate);
    }

    this.#rotateLeft.addEventListener("click", () => this.#preview?.rotateBy(-Math.PI / 6));
    this.#rotateRight.addEventListener("click", () => this.#preview?.rotateBy(Math.PI / 6));
    this.#rotateToggle.addEventListener("click", () => {
      this.#autoRotate = !this.#autoRotate;
      this.#preview?.setAutoRotate(this.#autoRotate);
      this.#renderControls();
    });
  }

  attachShop(source: GarageShopSource): void {
    this.#purchase.attach(source);
  }

  mount(): void {
    this.host.append(this.#root);
    this.#render();
  }

  #build(): void {
    const heading = document.createElement("h2");
    heading.textContent = "Garage / Shop";

    const intro = document.createElement("p");
    intro.textContent =
      "Slots und Items ansehen, Look als Vorschau ändern. Gesperrte Items bleiben als Vorschau sichtbar.";

    const status = document.createElement("p");
    status.className = "garage__status";
    status.setAttribute("role", "status");
    status.textContent =
      "Vorschau ändert nur die Ansicht. Käufe bucht der Server; Ausrüsten folgt später.";

    this.#root.className = "garage";
    this.#root.dataset["testid"] = "garage-shop";
    this.#slotHost.className = "garage__slots";
    this.#slotHost.setAttribute("role", "group");
    this.#slotHost.setAttribute("aria-label", "Ausrüstungsbereich");

    const body = document.createElement("div");
    body.className = "garage__body";
    body.append(this.#buildPreviewSection(), this.#buildBrowseSection());
    this.#root.append(heading, intro, status, this.#slotHost, body, this.#buildDetails());
  }

  #buildPreviewSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "garage__preview";
    section.setAttribute("aria-labelledby", "garage-preview-title");

    const title = document.createElement("h3");
    title.id = "garage-preview-title";
    title.textContent = "Vorschau";

    this.#previewHost.className = "garage__preview-host";
    this.#previewHost.dataset["testid"] = "garage-preview";
    this.#previewHost.setAttribute("aria-live", "polite");
    this.#previewNote.className = "garage__preview-note";

    const controls = document.createElement("div");
    controls.className = "garage__preview-controls";
    controls.append(this.#rotateLeft, this.#rotateRight, this.#rotateToggle);
    section.append(title, this.#previewHost, this.#previewNote, controls);

    return section;
  }

  #buildBrowseSection(): HTMLElement {
    const section = this.#browseSection;

    section.className = "garage__browse";
    section.setAttribute("aria-labelledby", "garage-items-title");

    const title = document.createElement("h3");
    title.id = "garage-items-title";
    title.textContent = "Items";

    this.#itemHost.className = "garage__items";
    this.#itemHost.setAttribute("aria-label", "Items im gewählten Bereich");
    section.append(title, this.#itemHost);

    return section;
  }

  #buildDetails(): HTMLElement {
    const section = document.createElement("section");
    section.className = "garage__details";
    section.setAttribute("aria-labelledby", "garage-item-name");

    this.#itemName.id = "garage-item-name";
    this.#itemName.dataset["testid"] = "garage-item-name";
    this.#itemMeta.className = "garage__item-meta";
    this.#price.className = "garage__price";
    this.#price.dataset["testid"] = "garage-price";
    this.#colors.className = "garage__colors";

    section.append(
      this.#itemName,
      this.#itemMeta,
      this.#price,
      this.#colors,
      this.#purchase.button,
      this.#purchase.confirmation,
      this.#purchase.hint,
    );

    return section;
  }

  #dispatch(action: Readonly<GarageAction>): void {
    this.#state = garageReducer(this.#state, action);
    this.#preview?.setLook(this.#state.config);
    this.#render();
  }

  #render(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset["garageFocus"] : undefined;

    this.#renderSlots();
    this.#renderItems();
    this.#renderDetails();
    this.#renderControls();

    if (focusKey !== undefined) {
      for (const element of this.#root.querySelectorAll<HTMLElement>("[data-garage-focus]")) {
        if (element.dataset["garageFocus"] === focusKey) {
          element.focus();
          break;
        }
      }
    }
  }

  #renderSlots(): void {
    this.#slotHost.replaceChildren(
      ...AVATAR_SLOTS.map((slot) => {
        const element = button(slotText(slot));
        const selected = slot === this.#state.selection.slot;
        element.setAttribute("aria-pressed", String(selected));
        element.dataset["garageFocus"] = `slot:${slot}`;
        element.dataset["testid"] = `garage-slot-${slot}`;
        element.addEventListener("click", () => {
          this.#dispatch({ kind: "selectSlot", slot });
        });

        return element;
      }),
    );
  }

  #renderItems(): void {
    this.#itemHost.replaceChildren(
      ...avatarItemsForSlot(this.#state.selection.slot).map((item: Readonly<ItemDef>) => {
        const row = document.createElement("li");
        const element = button(item.name);
        const selected = item.id === this.#state.selection.item.id;
        element.setAttribute("aria-pressed", String(selected));
        element.dataset["garageFocus"] = `item:${item.id}`;
        element.dataset["testid"] = `garage-item-${item.id}`;
        element.addEventListener("click", () => {
          this.#dispatch({ kind: "selectItem", slot: item.slot, item });
        });
        row.append(element);

        return row;
      }),
    );
  }

  #renderDetails(): void {
    const { item, colors } = this.#state.selection;
    const skin = item.slot === "skin";

    this.#browseSection.hidden = skin;
    this.#itemName.textContent = skin ? "Hautfarbe" : item.name;
    this.#itemMeta.textContent = `${rarityText(item.rarity)} · ${itemUnlockText(item)}`;
    this.#price.textContent = priceText(item);
    this.#itemMeta.hidden = skin;
    this.#price.hidden = skin;
    this.#purchase.show(item, !skin);
    this.#colors.hidden = colors.length === 0;
    this.#colors.replaceChildren();

    const legend = document.createElement("legend");
    legend.textContent = skin ? "Hautfarbe" : "Farben";
    this.#colors.append(legend);

    for (const [index, selectedColor] of colors.entries()) {
      for (const color of previewColorOptions(item.slot)) {
        const label = document.createElement("label");
        label.className = "garage__color";
        label.title = color;
        const input = document.createElement("input");
        const swatch = document.createElement("span");
        input.type = "radio";
        input.name = `garage-color-${index}`;
        input.value = color;
        input.checked = color === selectedColor;
        input.setAttribute("aria-label", `Farbe ${index + 1}: ${color}`);
        input.dataset["garageFocus"] = `color:${index}:${color}`;
        swatch.style.backgroundColor = color;
        swatch.setAttribute("aria-hidden", "true");
        input.addEventListener("change", () => {
          if (input.checked) this.#dispatch({ kind: "selectColor", index, color });
        });
        label.append(input, swatch);
        this.#colors.append(label);
      }
    }
  }

  #renderControls(): void {
    const available = this.#state.kind === "preview";
    this.#previewHost.dataset["previewState"] = this.#state.kind;
    this.#previewNote.textContent = available
      ? "Provisorische Fahrer- und Radgeometrie. Finale Blender-Assets ersetzen sie später."
      : "3D nicht verfügbar. Item-Auswahl, Farben und Informationen bleiben nutzbar.";
    this.#rotateLeft.disabled = !available;
    this.#rotateRight.disabled = !available;
    this.#rotateToggle.disabled = !available;
    this.#rotateToggle.textContent = this.#autoRotate ? "Drehung pausieren" : "Drehung starten";
    this.#rotateToggle.setAttribute("aria-pressed", String(this.#autoRotate));
  }
}

export type GarageHandle = Pick<GaragePanel, "attachShop">;

export function mountGarage(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The panel owns the host's menu children.
  host: HTMLElement,
  wheelCircM: number,
): GarageHandle {
  const panel = new GaragePanel(host, wheelCircM);
  panel.mount();

  return panel;
}
