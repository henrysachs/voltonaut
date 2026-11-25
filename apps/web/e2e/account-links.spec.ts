import { expect, test, type Locator } from "@playwright/test";
import type { Page, Response, Route } from "@playwright/test";
import { openGameMenu } from "./helpers/gameMenu.js";

// Connecting a further login provider (#97): a session that cannot be stored must not leave the
// tab, while a stored session survives the provider round trip and completes the link once.
const API = "http://127.0.0.1:3000";
const LINK_CODE = "c".repeat(43);
const CLOUDFLARE = { providerId: "cloudflare", displayName: "Cloudflare Access" };
const AUTHENTIK = { providerId: "authentik", displayName: "authentik" };

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const PROVIDERS = [
  { id: "cloudflare", displayName: "Cloudflare Access" },
  { id: "authentik", displayName: "authentik" },
];

const NOT_FOUND = JSON.stringify({
  error: { code: "not_found", message: "not part of this test" },
});

/** In-memory stand-in for the API; records every non-preflight call. */
class FakeApi {
  readonly calls: string[] = [];
  linked = false;

  body(key: string, webOrigin: string): string | undefined {
    switch (key) {
      case "POST /v1/auth/oidc/exchange":
        return JSON.stringify({ sessionToken: "s".repeat(43), user: USER });
      case "GET /v1/me":
        return JSON.stringify({ user: USER });
      case "GET /v1/auth/config":
        return JSON.stringify({ mode: "oidc", providers: PROVIDERS });
      case "GET /v1/auth/identities":
        return JSON.stringify({ identities: this.linked ? [CLOUDFLARE, AUTHENTIK] : [CLOUDFLARE] });
      // Stands in for the provider round trip: straight back to the finish page with a link code.
      case "POST /v1/auth/oidc/authentik/link":
        return JSON.stringify({ location: `${webOrigin}/auth/finish?link=${LINK_CODE}` });
      case "POST /v1/auth/identities":
        this.linked = true;

        return JSON.stringify({ identities: [CLOUDFLARE, AUTHENTIK] });
      default:
        return undefined;
    }
  }

  async handle(route: Readonly<Route>): Promise<void> {
    const request = route.request();
    const origin = request.headers()["origin"] ?? "";
    const key = `${request.method()} ${new URL(request.url()).pathname}`;

    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });

      return;
    }

    this.calls.push(key);
    const body = this.body(key, origin);

    await route.fulfill({
      status: body === undefined ? 404 : 200,
      headers,
      contentType: "application/json",
      body: body ?? NOT_FOUND,
    });
  }
}

function denyStorage(): void {
  for (const name of ["localStorage", "indexedDB"]) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
async function signedIn(page: Page, storage: "available" | "denied"): Promise<FakeApi> {
  const api = new FakeApi();

  if (storage === "denied") await page.context().addInitScript(denyStorage);
  await page.route(`${API}/**`, async (route: Readonly<Route>) => {
    await api.handle(route);
  });
  await page.goto(`/auth/finish?code=${"a".repeat(43)}`);
  await openGameMenu(page, "Konto");

  return api;
}

async function expectDisabledButton(button: Readonly<Locator>): Promise<void> {
  await expect(button).toHaveCSS("cursor", "default");
  await expect(button).toHaveCSS("opacity", "0.55");
  await expect(button).toHaveCSS("background-color", "rgb(37, 67, 61)");
  await button.hover();
  await expect(button).toHaveCSS("background-color", "rgb(37, 67, 61)");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("does not leave the tab to link while the session lives only in this tab", async ({
  page,
}) => {
  const api = await signedIn(page, "denied");
  const account = page.getByRole("tabpanel", { name: "Konto", exact: true });

  await expect(account).toContainText("Nur in diesem Tab");
  await expect(account.getByRole("listitem")).toHaveText(["Cloudflare Access"]);

  const connect = account.getByRole("button", { name: "Mit authentik verbinden", exact: true });

  await expect(connect).toHaveAttribute("aria-disabled", "true");
  await expect(connect).toHaveAccessibleDescription(/ginge beim Wechsel zum Anbieter verloren/u);
  // Still reachable by keyboard; activating it explains instead of leaving the tab.
  await connect.focus();
  await page.keyboard.press("Enter");
  await expect(connect).toBeFocused();
  await expect(account).toContainText("ginge beim Wechsel zum Anbieter verloren");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(account).toContainText("Angemeldet als rider@example.com");
  expect(api.calls.filter((call) => call.includes("/link"))).toEqual([]);
  expect(api.calls).not.toContain("POST /v1/auth/identities");
  expect(new URL(page.url()).pathname).toBe("/");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("matches disabled account button states and preserves keyboard focus", async ({ page }) => {
  await signedIn(page, "denied");
  const account = page.getByRole("tabpanel", { name: "Konto", exact: true });
  const connect = account.getByRole("button", { name: "Mit authentik verbinden", exact: true });

  const nativeDisabled = account.getByRole("button", {
    name: "Serverprofil für nächste Fahrt lokal verwenden",
    exact: true,
  });

  await expect(connect).toHaveAttribute("aria-disabled", "true");
  await expect(nativeDisabled).toBeDisabled();

  await expectDisabledButton(connect);
  await expectDisabledButton(nativeDisabled);

  await account.getByRole("button", { name: "Abmelden", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(connect).toBeFocused();
  await expect(connect).toHaveCSS("outline-style", "solid");
  await expect(connect).toHaveCSS("outline-width", "3px");
  await expect(connect).toHaveCSS("outline-color", "rgb(255, 214, 10)");
  await expect(connect).toHaveCSS("outline-offset", "3px");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("preserves enabled primary and secondary hover colors", async ({ page }) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Profil");

  const menu = page.getByRole("dialog", { name: "Fahrtmenü", exact: true });
  const primary = menu.getByRole("button", { name: "Zurück zur Fahrt", exact: true });

  await expect(primary).toBeEnabled();
  await primary.hover();
  await expect(primary).toHaveCSS("background-color", "rgb(255, 234, 129)");

  const secondary = menu.getByRole("button", { name: "Geräte öffnen", exact: true });

  await expect(secondary).toBeEnabled();
  await secondary.hover();
  await expect(secondary).toHaveCSS("background-color", "rgb(53, 87, 76)");
});

/** Only the completing POST; the initial GET of the same URL may still be in flight. */
function isLinkCompletion(response: Readonly<Response>): boolean {
  return response.url() === `${API}/v1/auth/identities` && response.request().method() === "POST";
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("keeps a stored session through the provider round trip and completes the link once", async ({
  page,
}) => {
  const api = await signedIn(page, "available");
  const account = page.getByRole("tabpanel", { name: "Konto", exact: true });

  await expect(account).toContainText("Session lokal gemerkt");

  const returned = page.waitForResponse(isLinkCompletion, { timeout: 15_000 });

  await account.getByRole("button", { name: "Mit authentik verbinden", exact: true }).click();
  // The completion request only exists after the round trip back and the restored session.
  await returned;
  expect(page.url()).toBe(new URL("/", page.url()).href);
  await openGameMenu(page, "Konto");
  const after = page.getByRole("tabpanel", { name: "Konto", exact: true });

  await expect(after).toContainText("Angemeldet als rider@example.com");
  await expect(after.getByRole("listitem")).toHaveText(["Cloudflare Access", "authentik"]);
  await expect(after).toContainText("Anmeldung verbunden");
  expect(api.calls).toContain("POST /v1/auth/oidc/authentik/link");
  expect(api.calls.filter((call) => call === "POST /v1/auth/identities")).toHaveLength(1);
});
