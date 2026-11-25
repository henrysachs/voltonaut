import { MembershipSchema } from "@voltonaut/shared";
import type {
  AccountAdministration,
  AdministrationView,
  AdministrationUser,
} from "../sync/accountAdministration.js";

type Commands = Readonly<Pick<AccountAdministration, "subscribe" | "actions">>;

type Actions = ReturnType<Commands["actions"]>;

function text(value: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = value;

  return element;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);

  return element;
}

function userForm(user: AdministrationUser, actions: Actions, busy: boolean): HTMLElement {
  const form = document.createElement("form");
  form.setAttribute("aria-label", `Mitgliedschaft ${user.email}`);
  form.append(text(`${user.displayName ?? user.email} · ${user.email} · ${user.id}`));
  const tierLabel = document.createElement("label");
  tierLabel.textContent = "Mitgliedsstufe ";
  const tier = document.createElement("select");

  for (const [value, label] of Object.entries({
    normal: "Normal",
    premium: "Premium",
    pro: "Pro",
  })) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    tier.append(option);
  }

  tier.value = user.membership.tier;
  tierLabel.append(tier);
  const vipLabel = document.createElement("label");
  vipLabel.textContent = " VIP ";
  const vip = document.createElement("input");
  vip.type = "checkbox";
  vip.checked = user.membership.vip;
  vipLabel.append(vip);

  const save = button("Mitgliedschaft speichern", () => {
    const membership = MembershipSchema.parse({ tier: tier.value, vip: vip.checked });
    void actions.save(user.id, membership);
  });

  tier.disabled = busy;
  vip.disabled = busy;
  save.disabled = busy;
  save.setAttribute("aria-busy", String(busy));
  form.addEventListener("submit", (event: Readonly<Pick<SubmitEvent, "preventDefault">>) => {
    event.preventDefault();
  });
  form.append(tierLabel, vipLabel, save);

  return form;
}

function render(
  host: Readonly<Pick<Element, "append" | "replaceChildren">>,
  view: AdministrationView,
  actions: Actions,
): void {
  host.replaceChildren();

  if (view.kind === "guest") return;

  if (view.kind !== "ready") {
    host.append(text(view.kind === "loading" ? "Mitgliedschaft wird geladen …" : view.message));

    if (view.kind === "failed")
      host.append(
        button("Mitgliedschaft aktualisieren", () => {
          void actions.refresh();
        }),
      );

    return;
  }

  const membership = view.status.membership;
  const names = { normal: "Normal", premium: "Premium", pro: "Pro" };
  host.append(text(`Mitgliedschaft: ${names[membership.tier]}${membership.vip ? " · VIP" : ""}`));

  if (view.message !== "") {
    const message = text(view.message);
    message.setAttribute("role", "status");
    host.append(message);
  }

  if (view.status.authorization.role === "admin" && view.directory !== null)
    host.append(adminPanel(view, actions));
}

function adminPanel(
  view: Extract<AdministrationView, { readonly kind: "ready" }>,
  actions: Actions,
): HTMLElement {
  const host = document.createElement("section");

  if (view.directory === null) return host;
  const title = document.createElement("h3");
  title.textContent = "Nutzerverwaltung";
  host.append(
    title,
    text("Stufe und VIP vergeben keine Adminrechte. Keine Preise oder Spielsperren."),
  );

  const refresh = button("Nutzerliste aktualisieren", () => {
    void actions.refresh();
  });

  refresh.disabled = view.busy;
  refresh.setAttribute("aria-busy", String(view.busy));
  host.append(refresh);

  for (const user of view.directory.users) host.append(userForm(user, actions, view.busy));

  if (view.directory.nextCursor !== null) {
    const next = button("Nächste Nutzerseite", () => {
      void actions.next();
    });

    next.disabled = view.busy;
    next.setAttribute("aria-busy", String(view.busy));
    host.append(next);
  }

  return host;
}

export function mountAccountMembershipPanel(sync: Commands): void {
  const host = document.querySelector("#account-membership");

  if (host === null) return;
  sync.subscribe((view) => {
    render(host, view, sync.actions());
  });
}
