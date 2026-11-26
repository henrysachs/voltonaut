import { AVATAR_SLOTS } from "@voltonaut/rules";
import type { AvatarConfig, AvatarSlot, ItemDef } from "@voltonaut/shared";

import { button } from "../button.js";
import { garageItemStatus, itemStatusText } from "./equipOffer.js";
import { slotText } from "./garageText.js";

export function garageButton(text: string): HTMLButtonElement {
  const element = button(text);
  element.setAttribute("class", "btn btn--secondary");

  return element;
}

export interface ItemRowsInput {
  readonly items: readonly Readonly<ItemDef>[];
  readonly selectedId: string;
  readonly owned: readonly string[];
  readonly equipped: Readonly<AvatarConfig>;
  readonly select: (item: Readonly<ItemDef>) => void;
}

/** One button per item with its state (spec E7-05 AK6); locked items stay selectable as preview. */
export function itemRows(input: ItemRowsInput): HTMLLIElement[] {
  return input.items.map((item) => {
    const row = document.createElement("li");
    const element = garageButton(item.name);
    const status = garageItemStatus(item, input.owned, input.equipped);
    const label = document.createElement("span");

    label.className = "garage__item-status";
    label.dataset["testid"] = `garage-item-status-${item.id}`;
    label.textContent = itemStatusText(item, status);
    element.append(" ", label);
    element.setAttribute("aria-pressed", String(item.id === input.selectedId));
    element.dataset["garageFocus"] = `item:${item.id}`;
    element.dataset["testid"] = `garage-item-${item.id}`;
    element.dataset["status"] = status;
    element.addEventListener("click", () => {
      input.select(item);
    });
    row.append(element);

    return row;
  });
}

export interface ColorChoicesInput {
  readonly slot: ItemDef["slot"];
  readonly selected: readonly string[];
  readonly options: readonly string[];
  readonly choose: (index: number, color: string) => void;
}

/** Radio swatches per colorable part of the selected item. */
export function colorChoices(input: ColorChoicesInput): HTMLLabelElement[] {
  return input.selected.flatMap((selectedColor, index) =>
    input.options.map((color) => {
      const label = document.createElement("label");
      const choice = document.createElement("input");
      const swatch = document.createElement("span");

      label.className = "garage__color";
      label.title = color;
      choice.type = "radio";
      choice.name = `garage-color-${index}`;
      choice.value = color;
      choice.checked = color === selectedColor;
      choice.setAttribute("aria-label", `Farbe ${index + 1}: ${color}`);
      choice.dataset["garageFocus"] = `color:${index}:${color}`;
      swatch.style.backgroundColor = color;
      swatch.setAttribute("aria-hidden", "true");
      choice.addEventListener("change", () => {
        if (choice.checked) input.choose(index, color);
      });
      label.append(choice, swatch);

      return label;
    }),
  );
}

export function slotButtons(
  selected: AvatarSlot,
  select: (slot: AvatarSlot) => void,
): HTMLButtonElement[] {
  return AVATAR_SLOTS.map((slot) => {
    const element = garageButton(slotText(slot));

    element.setAttribute("aria-pressed", String(slot === selected));
    element.dataset["garageFocus"] = `slot:${slot}`;
    element.dataset["testid"] = `garage-slot-${slot}`;
    element.addEventListener("click", () => {
      select(slot);
    });

    return element;
  });
}
