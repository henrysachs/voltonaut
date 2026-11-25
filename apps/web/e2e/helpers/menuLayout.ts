/* oxlint-disable typescript/prefer-readonly-parameter-types -- Browser-owned DOM nodes and Playwright locators retain native mutable members. */
import type { Page } from "@playwright/test";

const INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "summary",
  "label:has(input, select, textarea)",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[contenteditable="true"]',
].join(", ");

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface OverflowMeasurement {
  readonly name: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

interface FooterOverlap {
  readonly name: string;
  readonly bottom: number;
  readonly footerTop: number;
}

export interface LayoutSnapshot {
  readonly viewport: Rect;
  readonly dialog: Rect;
  readonly content: Rect & {
    readonly scrollHeight: number;
    readonly clientHeight: number;
    readonly scrollTop: number;
    readonly overflows: boolean;
    readonly scrollable: string | null;
    readonly boxShadow: string;
  };
  readonly footer: Rect;
  readonly profile: Rect;
  readonly mode: Rect;
  readonly modeVisible: boolean;
  readonly modeInsideProfile: boolean;
  readonly modeInsideDialog: boolean;
  readonly tabs: readonly { readonly name: string; readonly rect: Rect }[];
  readonly horizontalOverflow: readonly OverflowMeasurement[];
  readonly footerOverlaps: readonly FooterOverlap[];
  readonly world: Rect;
  readonly hud: Rect;
  readonly document: {
    readonly scrollWidth: number;
    readonly scrollHeight: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
  };
}

function readRects(
  page: Readonly<Page>,
): Promise<
  Omit<
    LayoutSnapshot,
    "content" | "tabs" | "horizontalOverflow" | "footerOverlaps" | "document"
  > & { readonly content: Rect }
> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- Browser evaluate callbacks cannot close over module-scope helpers.
    function requiredElement(selector: string): HTMLElement {
      const element = document.querySelector<HTMLElement>(selector);

      if (element === null) throw new Error(`Missing layout element: ${selector}`);

      return element;
    }

    // oxlint-disable-next-line unicorn/consistent-function-scoping -- Browser evaluate callbacks cannot close over module-scope helpers.
    function readRect(element: Element): Rect {
      const { left, top, right, bottom } = element.getBoundingClientRect();

      return { left, top, right, bottom };
    }

    const dialog = requiredElement("#game-menu");
    const content = requiredElement(".game-menu__content");
    const profile = requiredElement("#rider-profile");
    const mode = requiredElement("#ride-mode");

    return {
      viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
      dialog: readRect(dialog),
      content: readRect(content),
      footer: readRect(requiredElement(".game-menu__footer")),
      profile: readRect(profile),
      mode: readRect(mode),
      modeVisible: mode.getClientRects().length > 0,
      modeInsideProfile: profile.contains(mode),
      modeInsideDialog: dialog.contains(mode),
      world: readRect(requiredElement("#ride-scene")),
      hud: readRect(requiredElement(".hud")),
    };
  });
}

function readContent(
  page: Readonly<Page>,
): Promise<Pick<LayoutSnapshot, "content" | "horizontalOverflow">> {
  return page.evaluate(() => {
    const tablist = document.querySelector<HTMLElement>(".game-menu__tabs");
    const dialog = document.querySelector<HTMLElement>("#game-menu");
    const content = document.querySelector<HTMLElement>(".game-menu__content");

    if (tablist === null || dialog === null || content === null)
      throw new Error("Missing menu layout container");

    const horizontalOverflow: OverflowMeasurement[] = [];

    for (const entry of [
      { name: "tablist", element: tablist },
      { name: "dialog", element: dialog },
      { name: "content", element: content },
    ]) {
      if (entry.element.scrollWidth > entry.element.clientWidth + 1)
        horizontalOverflow.push({
          name: entry.name,
          scrollWidth: entry.element.scrollWidth,
          clientWidth: entry.element.clientWidth,
        });
    }

    const { left, top, right, bottom } = content.getBoundingClientRect();

    return {
      content: {
        left,
        top,
        right,
        bottom,
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
        scrollTop: content.scrollTop,
        overflows: content.scrollHeight > content.clientHeight,
        scrollable: content.dataset["scrollable"] ?? null,
        boxShadow: getComputedStyle(content).boxShadow,
      },
      horizontalOverflow,
    };
  });
}

function readTabs(page: Readonly<Page>): Promise<Pick<LayoutSnapshot, "tabs">> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>("#game-menu");

    if (dialog === null) throw new Error("Missing menu dialog");

    return {
      tabs: [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map((button) => {
        const { left, top, right, bottom } = button.getBoundingClientRect();

        return {
          name: button.textContent?.trim() ?? button.id,
          rect: { left, top, right, bottom },
        };
      }),
    };
  });
}

function readFooterOverlaps(page: Readonly<Page>): Promise<Pick<LayoutSnapshot, "footerOverlaps">> {
  return page.evaluate((interactiveSelector) => {
    const content = document.querySelector(".game-menu__content");
    const footer = document.querySelector(".game-menu__footer");
    const panel = document.querySelector(".game-menu__content [role=tabpanel]:not([hidden])");

    if (content === null || footer === null || panel === null)
      throw new Error("Missing menu content boundary");

    const contentRect = content.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const footerOverlaps: FooterOverlap[] = [];

    for (const element of panel.querySelectorAll<HTMLElement>(interactiveSelector)) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;

      const rect = element.getBoundingClientRect();
      const left = Math.max(rect.left, contentRect.left);
      const top = Math.max(rect.top, contentRect.top);
      const right = Math.min(rect.right, contentRect.right);
      const bottom = Math.min(rect.bottom, contentRect.bottom);

      if (right <= left || bottom <= top) continue;

      if (bottom > footerRect.top + 1 && right > footerRect.left && left < footerRect.right)
        footerOverlaps.push({
          name:
            element.getAttribute("aria-label") ??
            element.textContent?.trim() ??
            element.id ??
            element.tagName.toLowerCase(),
          bottom,
          footerTop: footerRect.top,
        });
    }

    return { footerOverlaps };
  }, INTERACTIVE_SELECTOR);
}

function readDocument(page: Readonly<Page>): Promise<Pick<LayoutSnapshot, "document">> {
  return page.evaluate(() => ({
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    },
  }));
}

export function readLayout(page: Readonly<Page>): Promise<LayoutSnapshot> {
  return Promise.all([
    readRects(page),
    readContent(page),
    readTabs(page),
    readFooterOverlaps(page),
    readDocument(page),
  ]).then(([rects, content, tabs, footer, document]) => ({
    ...rects,
    ...content,
    ...tabs,
    ...footer,
    ...document,
  }));
}

export async function settleLayout(page: Readonly<Page>): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

export async function scrollContent(
  page: Readonly<Page>,
  position: "top" | "bottom",
): Promise<void> {
  await page.locator(".game-menu__content").evaluate((element, target) => {
    element.scrollTo({ top: target === "top" ? 0 : element.scrollHeight });
  }, position);
}
