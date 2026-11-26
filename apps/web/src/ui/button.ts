export function button(label: string, action?: () => void, disabled = false): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.disabled = disabled;

  if (action !== undefined) node.addEventListener("click", action);

  return node;
}

export function busyButton(label: string, action: () => void, busy: boolean): HTMLButtonElement {
  const node = button(label, action, busy);
  node.setAttribute("aria-busy", String(busy));

  return node;
}
