import type { ApplicationSession, SessionView } from "../sync/applicationSession.js";

function sessionText(view: SessionView): string {
  switch (view.kind) {
    case "guest":
      return view.message;
    case "authenticated":
      return `Angemeldet als ${view.user.email}. ${view.persistent ? "Session lokal gemerkt." : "Nur in diesem Tab; Speicher nicht verfügbar."}`;
    case "busy":
      return view.operation === "restoring"
        ? "Session wird geprüft …"
        : "Anmeldung wird vorbereitet …";
    default: {
      const exhausted: never = view;

      return exhausted;
    }
  }
}

export function mountAccountPanel(
  session: Readonly<Pick<ApplicationSession, "subscribe" | "login" | "logout">>,
): void {
  const choices = document.createElement("div");
  choices.setAttribute("role", "group");
  choices.setAttribute("aria-label", "Anmeldeanbieter");
  const host = document.querySelector("#account-panel");
  const status = document.createElement("p");
  const login = document.createElement("button");
  const logout = document.createElement("button");
  status.setAttribute("role", "status");
  login.textContent = "Anmelden";
  logout.textContent = "Abmelden";
  login.addEventListener("click", () => {
    void session.login();
  });
  logout.addEventListener("click", () => {
    void session.logout();
  });
  session.subscribe((view) => {
    status.textContent = sessionText(view);
    login.hidden = view.kind === "authenticated";
    login.disabled = view.kind === "busy";
    logout.hidden = view.kind === "guest";
    choices.replaceChildren(
      ...(view.kind === "guest" ? (view.providers ?? []) : []).map((provider) => {
        const button = document.createElement("button");
        button.textContent = `Anmelden mit ${provider.displayName}`;
        button.addEventListener("click", () => {
          void session.login(provider.id);
        });

        return button;
      }),
    );
  });
  host?.append(status, login, choices, logout);
}
