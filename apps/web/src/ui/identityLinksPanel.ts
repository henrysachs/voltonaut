import type { IdentityLinks, IdentityLinksView } from "../sync/identityLinks.js";

function linkedItems(view: IdentityLinksView): HTMLLIElement[] {
  if (view.kind !== "ready") return [];

  return view.linked.map((identity) => {
    const item = document.createElement("li");
    item.textContent = identity.displayName;

    return item;
  });
}

function connectButtons(
  view: IdentityLinksView,
  links: Readonly<Pick<IdentityLinks, "connect">>,
): HTMLButtonElement[] {
  if (view.kind !== "ready") return [];

  return view.available.map((provider) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Mit ${provider.displayName} verbinden`;
    button.disabled = view.busy;
    button.addEventListener("click", () => {
      void links.connect(provider.id);
    });

    return button;
  });
}

/** Account menu section: connected login providers and buttons to connect further ones. */
export function mountIdentityLinksPanel(
  links: Readonly<Pick<IdentityLinks, "subscribe" | "connect">>,
): void {
  const host = document.querySelector("#account-panel");
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  const list = document.createElement("ul");
  const actions = document.createElement("div");
  const status = document.createElement("p");
  heading.textContent = "Verbundene Anmeldungen";
  section.setAttribute("aria-label", "Verbundene Anmeldungen");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Weitere Anmeldung verbinden");
  status.setAttribute("role", "status");
  section.hidden = true;
  status.hidden = true;
  section.append(heading, list, actions);

  links.subscribe((view) => {
    section.hidden = view.kind !== "ready";
    list.replaceChildren(...linkedItems(view));
    actions.replaceChildren(...connectButtons(view, links));
    status.textContent = view.message;
    status.hidden = view.message === "";
  });
  host?.append(section, status);
}
