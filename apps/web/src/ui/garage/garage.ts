import { avatarItemsForSlot, avatarColorOptions } from "@voltonaut/rules";

import type { GarageLoadout, GarageLoadoutView } from "../../sync/garageLoadout.js";
import type { GarageShopView } from "../../sync/garageShop.js";
import { GarageEquip } from "./equip.js";
import { equipOffer, ownedItemIds, sameLoadout } from "./equipOffer.js";
import { colorChoices, garageButton as button, itemRows, slotButtons } from "./garageItems.js";
import { itemUnlockText, priceText, rarityText } from "./garageText.js";
import { GaragePurchase, type GarageShopSource } from "./purchase.js";
import { createGaragePreviewView, type GaragePreviewView } from "./preview.js";
import {
  createInitialGarageState,
  garageReducer,
  type GarageAction,
  type GarageState,
} from "./state.js";

/** The account's garage sync the panel reads and writes. */
export interface GarageAccountSource {
  readonly shop: GarageShopSource;
  readonly loadout: Pick<GarageLoadout, "subscribe" | "save">;
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
  readonly #equip = new GarageEquip({
    equip: () => {
      const offer = equipOffer(this.#state, this.#shopView, this.#loadoutView);

      if (offer.equipEnabled) void this.#account?.loadout.save(offer.target);
    },
    discard: () => {
      this.#dispatch({ kind: "discardPreview" });
    },
  });
  #shopView: GarageShopView = { kind: "guest" };
  #loadoutView: GarageLoadoutView = { kind: "guest" };
  #account: GarageAccountSource | undefined;
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

  attachAccount(source: GarageAccountSource): void {
    this.#account = source;
    this.#purchase.attach(source.shop);
    source.shop.subscribe((view) => {
      this.#shopView = view;
      this.#render();
    });
    source.loadout.subscribe((view) => {
      this.#loadoutView = view;

      // Only a changed confirmed equipment replaces the preview; a failed save keeps it.
      if (view.kind === "ready" && !sameLoadout(view.loadout, this.#state.equipped))
        this.#dispatch({ kind: "loadoutConfirmed", loadout: view.loadout });
      else this.#render();
    });
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
      "Vorschau ändert nur die Ansicht. Käufe und Ausrüstung speichert der Server für dein Konto.";

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
      this.#equip.root,
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
      ...slotButtons(this.#state.selection.slot, (slot) => {
        this.#dispatch({ kind: "selectSlot", slot });
      }),
    );
  }

  #renderItems(): void {
    this.#itemHost.replaceChildren(
      ...itemRows({
        items: avatarItemsForSlot(this.#state.selection.slot),
        selectedId: this.#state.selection.item.id,
        owned: ownedItemIds(this.#shopView),
        equipped: this.#state.equipped,
        select: (item) => {
          this.#dispatch({ kind: "selectItem", slot: item.slot, item });
        },
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

    this.#colors.append(
      ...colorChoices({
        slot: item.slot,
        selected: colors,
        options: avatarColorOptions(item.slot),
        choose: (index, color) => {
          this.#dispatch({ kind: "selectColor", index, color });
        },
      }),
    );
    this.#equip.render(equipOffer(this.#state, this.#shopView, this.#loadoutView), true);
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

export type GarageHandle = Pick<GaragePanel, "attachAccount">;

export function mountGarage(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The panel owns the host's menu children.
  host: HTMLElement,
  wheelCircM: number,
): GarageHandle {
  const panel = new GaragePanel(host, wheelCircM);
  panel.mount();

  return panel;
}
