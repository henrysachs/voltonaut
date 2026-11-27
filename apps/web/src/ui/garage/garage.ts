import { DEFAULT_AVATAR_CONFIG, avatarItemsForSlot, avatarColorOptions } from "@voltonaut/rules";

import type { GarageLoadout, GarageLoadoutView } from "../../sync/garageLoadout.js";
import type { GarageShopView } from "../../sync/garageShop.js";
import { GarageEquip } from "./equip.js";
import { equipOffer, ownedItemIds, sameLoadout } from "./equipOffer.js";
import { colorChoices, itemRows, slotButtons } from "./garageItems.js";
import { itemUnlockText, priceText, rarityText } from "./garageText.js";
import { GaragePreviewPanel } from "./previewPanel.js";
import { GaragePurchase, type GarageShopSource } from "./purchase.js";
import {
  createInitialGarageState,
  garageReducer,
  type GarageAction,
  type GarageState,
} from "./state.js";

/** The account's garage sync the panel reads and writes. */
interface GarageAccountSource {
  readonly shop: GarageShopSource;
  readonly loadout: Pick<GarageLoadout, "subscribe" | "save">;
}

class GaragePanel {
  readonly #slotHost = document.createElement("div");
  readonly #browseSection = document.createElement("section");
  readonly #itemHost = document.createElement("ul");
  readonly #preview: GaragePreviewPanel;
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
  readonly #root = document.createElement("div");
  #state: GarageState;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The panel owns the host's menu children.
    private readonly host: HTMLElement,
    wheelCircM: number,
  ) {
    this.#state = createInitialGarageState();
    this.#preview = new GaragePreviewPanel(wheelCircM, () => {
      this.#dispatch({ kind: "previewUnavailable" });
    });
    this.#build();

    if (this.#preview.available) this.#preview.setLook(this.#state.config);
    else this.#state = garageReducer(this.#state, { kind: "previewUnavailable" });
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

      // The garage follows the equipment the ride wears (`wornLoadout`); a failed save keeps the preview.
      const worn = view.kind === "ready" ? view.loadout : DEFAULT_AVATAR_CONFIG;

      if (view.kind !== "loading" && !sameLoadout(worn, this.#state.equipped))
        this.#dispatch({ kind: "loadoutConfirmed", loadout: worn });
      else this.#render();
    });
  }

  /** A rider selection after a failed shop read is the rider asking for the shop again. */
  #select(action: Readonly<GarageAction>): void {
    if (this.#shopView.kind === "failed") void this.#account?.shop.retry();
    this.#dispatch(action);
  }

  mount(): void {
    this.host.append(this.#root);
    this.#render();
  }

  #build(): void {
    const heading = document.createElement("h2");
    heading.className = "garage__heading";
    heading.textContent = "Garage / Shop";

    const intro = document.createElement("p");
    intro.className = "garage__intro";
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
    body.append(this.#preview.section, this.#buildBrowseSection());
    this.#root.append(heading, intro, status, this.#slotHost, body, this.#buildDetails());
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
    this.#preview.setLook(this.#state.config);
    this.#render();
  }

  #render(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset["garageFocus"] : undefined;

    this.#renderSlots();
    this.#renderItems();
    this.#renderDetails();
    this.#preview.render(this.#state.kind);

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
        this.#select({ kind: "selectSlot", slot });
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
          this.#select({ kind: "selectItem", slot: item.slot, item });
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
    this.#equip.render(equipOffer(this.#state, this.#shopView, this.#loadoutView));
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
