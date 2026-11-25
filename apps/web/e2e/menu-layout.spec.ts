/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture. */
import {
  expect,
  test,
  type Locator,
  type Page,
  type Response as PlaywrightResponse,
  type TestInfo,
} from "@playwright/test";
import type {
  AuthConfigResponse,
  InventoryResponse,
  ProgressConsentState,
  VoltsBalanceResponse,
} from "@voltonaut/shared";

import { API_ORIGIN, setupAccountPage } from "../src/sync/testdata/accountData.spec.js";
import { openGameMenu } from "./helpers/gameMenu.js";
import { assertFooterBoundary, assertLayout } from "./helpers/menuLayoutAssertions.js";
import { readLayout, scrollContent, settleLayout } from "./helpers/menuLayout.js";

const TABS = [
  { name: "Profil", slug: "profile" },
  { name: "Aufnahmen", slug: "recordings" },
  { name: "Konto", slug: "account" },
  { name: "Strava", slug: "strava" },
  { name: "App", slug: "app" },
  { name: "Garage / Shop", slug: "garage-shop" },
] as const;

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
] as const;

const STATES = ["guest", "authenticated"] as const;

const FIXTURE_PATHS = [
  "/v1/auth/config",
  "/v1/me/progress-consent",
  "/v1/me/volts",
  "/v1/me/inventory",
] as const;

const AUTH_CONFIG = {
  mode: "oidc",
  providers: [
    { id: "cloudflare", displayName: "Cloudflare Access" },
    { id: "authentik", displayName: "authentik" },
  ],
} satisfies AuthConfigResponse;

const PROGRESS_CONSENT = {
  version: 0,
  enabled: false,
  rewardsAvailable: true,
  sessionGeneration: 1,
} satisfies ProgressConsentState;

const VOLTS_BALANCE = { voltsBalance: 1500 } satisfies VoltsBalanceResponse;
const INVENTORY = { items: [] } satisfies InventoryResponse;

type State = (typeof STATES)[number];

type Tab = (typeof TABS)[number]["name"];

type Viewport = (typeof VIEWPORTS)[number];

function isFixtureResponse(
  response: Readonly<PlaywrightResponse>,
  path: (typeof FIXTURE_PATHS)[number],
): boolean {
  return response.request().method() === "GET" && response.url() === `${API_ORIGIN}${path}`;
}

async function registerAccountFixtures(page: Page): Promise<void> {
  await page.route(`${API_ORIGIN}/v1/auth/config`, (route) => route.fulfill({ json: AUTH_CONFIG }));
  await page.route(`${API_ORIGIN}/v1/me/progress-consent`, (route) =>
    route.fulfill({ json: PROGRESS_CONSENT }),
  );
  await page.route(`${API_ORIGIN}/v1/me/volts`, (route) => route.fulfill({ json: VOLTS_BALANCE }));
  await page.route(`${API_ORIGIN}/v1/me/inventory`, (route) => route.fulfill({ json: INVENTORY }));
}

async function waitForAuthenticatedAccount(page: Page): Promise<void> {
  const panel = page.getByRole("tabpanel", { name: "Konto", exact: true });

  const identities = panel.getByRole("region", {
    name: "Verbundene Anmeldungen",
    exact: true,
  });

  const data = panel.getByRole("region", { name: "Kontodaten", exact: true });

  await expect(identities).toBeVisible();
  await expect(identities.getByRole("listitem")).toHaveText(["Cloudflare Access", "authentik"]);
  await expect(
    panel.getByRole("region", {
      name: "Mitgliedschaft und Verwaltung",
      exact: true,
    }),
  ).toContainText("Mitgliedschaft: Normal");
  await expect(
    panel.getByRole("region", {
      name: "Automatischer Fahrtfortschritt",
      exact: true,
    }),
  ).toContainText("Zustimmung inaktiv");
  await expect(data).toContainText("Noch kein Serverprofil vorhanden.");
  await expect(data).toContainText("Noch keine Serverfahrten.");
  await expect(
    panel.getByRole("region", { name: "Kontowarteschlange", exact: true }),
  ).toContainText("Keine diesem Konto zugeordneten Aufträge geladen.");
}

async function setupPage(page: Page, state: State): Promise<void> {
  if (state === "guest") {
    await page.goto("/?sim=1&debug=1");
    await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");

    return;
  }

  await registerAccountFixtures(page);

  const fixtureResponses = FIXTURE_PATHS.map((path) =>
    page.waitForResponse((response) => isFixtureResponse(response, path)),
  );

  await setupAccountPage(page, 204, false);
  await Promise.all(fixtureResponses);
  await waitForAuthenticatedAccount(page);
}

async function waitForProfile(panel: Readonly<Locator>): Promise<void> {
  await expect(panel.getByTestId("profile-form")).toBeVisible();
}

async function waitForRecordings(panel: Readonly<Locator>): Promise<void> {
  await expect(panel.getByTestId("recording-status")).toContainText("Bereit.");
  await expect(panel.getByRole("button", { name: "Aufnahme starten", exact: true })).toBeVisible();
}

async function waitForAccount(page: Page, state: State): Promise<void> {
  if (state === "authenticated") {
    await waitForAuthenticatedAccount(page);

    return;
  }

  const panel = page.getByRole("tabpanel", { name: "Konto", exact: true });

  await expect(panel.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
  await expect(
    panel.getByRole("region", {
      name: "Automatischer Fahrtfortschritt",
      exact: true,
    }),
  ).toContainText("Gast. Automatischer Progress benötigt ein Konto.");
}

async function waitForGarage(panel: Readonly<Locator>, state: State): Promise<void> {
  const preview = panel.getByTestId("garage-preview");

  await expect(preview.locator("canvas")).toHaveAttribute("data-preview-ready", "true");
  await panel.getByTestId("garage-item-jersey.stripe").click();
  await expect(panel.getByTestId("garage-item-name")).toHaveText("Blitzstreifen");
  await expect(panel.getByTestId("garage-price")).toHaveText("1.500 ⚡");
  await expect(panel.getByTestId("garage-purchase-hint")).toHaveText(
    state === "authenticated"
      ? "Guthaben: 1.500 ⚡."
      : "Zum Kaufen anmelden. Bis dahin nur Vorschau.",
  );
}

async function waitForStrava(panel: Readonly<Locator>, state: State): Promise<void> {
  await expect(panel).toContainText(
    state === "authenticated"
      ? "Strava ist auf diesem Server deaktiviert."
      : "Für Strava ausdrücklich bei Voltonaut anmelden",
  );
}

async function waitForApp(panel: Readonly<Locator>): Promise<void> {
  await expect(panel).toContainText("Voltonaut läuft im Browser");
  await expect(panel.getByRole("button", { name: "Hard Reload", exact: true })).toBeVisible();
}

async function waitForPanelContent(page: Page, state: State, tab: Tab): Promise<void> {
  const panel = page.getByRole("tabpanel", { name: tab, exact: true });

  switch (tab) {
    case "Profil": {
      await waitForProfile(panel);
      await expect(page.getByRole("radio", { name: "Normal", exact: true })).toBeChecked();

      break;
    }

    case "Aufnahmen": {
      await waitForRecordings(panel);

      break;
    }

    case "Konto": {
      await waitForAccount(page, state);

      break;
    }

    case "Strava": {
      await waitForStrava(panel, state);

      break;
    }

    case "App": {
      await waitForApp(panel);

      break;
    }

    case "Garage / Shop": {
      await waitForGarage(panel, state);

      break;
    }

    default: {
      const exhaustive: never = tab;

      throw new Error(`Unsupported menu tab: ${String(exhaustive)}`);
    }
  }
}

async function attachScreenshot(
  page: Page,
  testInfo: Readonly<TestInfo>,
  state: State,
  tab: (typeof TABS)[number],
  viewport: Viewport,
): Promise<void> {
  if (viewport.width !== 390 && viewport.width !== 1440) return;

  const name = `${state}-${tab.slug}-${viewport.width}x${viewport.height}.png`;
  const path = testInfo.outputPath(name);

  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.use({ reducedMotion: "reduce" });

for (const state of STATES) {
  for (const tab of TABS) {
    for (const viewport of VIEWPORTS) {
      test(`${state} | ${tab.name} | ${viewport.width}x${viewport.height}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await setupPage(page, state);
        await openGameMenu(page, tab.name);
        await waitForPanelContent(page, state, tab.name);
        await scrollContent(page, "top");
        await settleLayout(page);
        await attachScreenshot(page, testInfo, state, tab, viewport);

        const top = await readLayout(page);

        assertLayout(top, tab.name);
        await scrollContent(page, "bottom");
        await settleLayout(page);

        const bottom = await readLayout(page);

        expect
          .soft(
            bottom.content.scrollTop + bottom.content.clientHeight,
            "content must reach its bottom before the repeated boundary check",
          )
          .toBeGreaterThanOrEqual(bottom.content.scrollHeight - 1);
        assertFooterBoundary(bottom, "bottom");
      });
    }
  }
}
