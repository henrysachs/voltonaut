import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { build } from "vite";
import { expect, it } from "vitest";

const CHANNEL = "00000000-0000-4000-8000-000000000001";
const CODE = "c".repeat(43);
const QUERY = `?channel=${CHANNEL}&code=${CODE}`;
const FINISH = { v: 1, type: "finish", channel: CHANNEL, result: { kind: "code", code: CODE } };

interface ResponsePort {
  readonly writeHead: (status: number, headers: Readonly<Record<string, string>>) => object;
  readonly end: (body?: string) => object;
}

async function serve(dist: string, url: string, response: ResponsePort): Promise<void> {
  try {
    let path = resolve(dist, `.${new URL(url, "http://127.0.0.1").pathname}`);

    assert.ok(path.startsWith(`${dist}/`));

    if ((await stat(path)).isDirectory()) path = join(path, "index.html");

    response.writeHead(200, {
      "Content-Type": extname(path) === ".html" ? "text/html" : "text/javascript",
      "Referrer-Policy": "no-referrer",
    });
    response.end(await readFile(path, "utf8"));
  } catch {
    response.writeHead(404, {});
    response.end();
  }
}

async function startServer(dist: string) {
  const server = createServer(
    (request: { readonly url?: string | undefined }, response: ResponsePort) => {
      void serve(dist, request.url ?? "/", response);
    },
  );

  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });

  const address = server.address();
  const port = address instanceof Object ? address.port : undefined;

  if (port === undefined) throw new Error("Missing test port");

  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      });
    },
  };
}

type BrowserPort = Readonly<Pick<Browser, "newContext">>;

type ContextPort = Readonly<Pick<BrowserContext, "newPage">>;

type RoutePort = Readonly<Pick<Route, "request" | "abort" | "continue">>;

type PagePort = Readonly<Pick<Page, "getByText" | "url">>;

type Messages = {
  readonly messages: readonly unknown[];
  readonly firstMessage: Readonly<Promise<void>>;
};

class FinishProbe {
  readonly requests: { readonly path: string; readonly activeQuery: string }[] = [];
  readonly networkRequests: { readonly path: string; readonly documentUrl: string }[] = [];
  readonly checks: string[] = [];
  blockedAssetQuery: string | null = null;

  constructor(
    private readonly browser: BrowserPort,
    private readonly origin: string,
  ) {}

  async blocked(): Promise<void> {
    const context = await this.browser.newContext();

    await context.route("**/*", (route: RoutePort) => {
      const request = route.request();

      if (new URL(request.url()).origin !== this.origin || request.resourceType() === "script")
        return route.abort();

      return route.continue();
    });

    const page = await context.newPage();

    await page.goto(`${this.origin}/strava/finish${QUERY}`);
    this.blockedAssetQuery = await page.evaluate(() => window.location.search);
    assert.equal(this.blockedAssetQuery, "", "blocked bootstrap must not retain handoff query");
    this.checks.push("query scrubbed with every external script blocked");
    await context.close();
  }

  private async receiver(context: ContextPort) {
    const page = await context.newPage();

    await page.goto(`${this.origin}/strava/bridge`);

    return page.evaluateHandle((id) => {
      const messages: unknown[] = [];
      const channel = new BroadcastChannel(`voltonaut-strava:${id}`);

      const firstMessage = new Promise<void>((received) => {
        channel.addEventListener("message", (event: { readonly data: unknown }) => {
          messages.push(event.data);
          received();
        });
      });

      return { messages, channel, firstMessage };
    }, CHANNEL);
  }

  private async rejected(page: PagePort): Promise<void> {
    await page
      .getByText("Rücksprung ungültig oder Kanal nicht verfügbar.", { exact: false })
      .waitFor();
    assert.equal(new URL(page.url()).search, "");
  }

  private observeNetwork(event: {
    readonly type?: string | undefined;
    readonly documentURL: string;
    readonly request: { readonly url: string };
  }): void {
    if (event.type !== "Script") return;

    this.networkRequests.push({
      path: new URL(event.request.url).pathname,
      documentUrl: event.documentURL,
    });
  }

  private async observedPage() {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const network = await context.newCDPSession(page);

    network.on(
      "Network.requestWillBeSent",
      (event: Parameters<FinishProbe["observeNetwork"]>[0]) => {
        this.observeNetwork(event);
      },
    );
    await network.send("Network.enable");

    await context.route("**/*", async (route: RoutePort) => {
      const request = route.request();

      if (new URL(request.url()).origin !== this.origin) return route.abort();

      if (request.resourceType() === "script" && request.frame().page() === page) {
        this.requests.push({
          path: new URL(request.url()).pathname,
          activeQuery: await page.evaluate(() => window.location.search),
        });
      }

      return route.continue();
    });

    return { context, page };
  }

  async loaded(): Promise<void> {
    const { context, page } = await this.observedPage();
    const receiver = await this.receiver(context);

    await page.goto(`${this.origin}/strava/finish${QUERY}`);
    await page.getByText("Ursprünglicher Tab prüft Browsercookie und Konto …").waitFor();
    await receiver.evaluate((state: Messages) => state.firstMessage);
    assert.equal(new URL(page.url()).search, "");
    assert.ok(this.requests.length > 0);
    assert.ok(this.requests.every((request) => request.activeQuery === ""));
    assert.ok(this.networkRequests.length > 0);
    assert.ok(this.networkRequests.every((request) => new URL(request.documentUrl).search === ""));
    assert.deepEqual(await receiver.evaluate((state: Messages) => state.messages), [FINISH]);
    assert.equal(await page.evaluate("takeStravaFinishQuery()"), "");
    this.checks.push(
      "first script request follows scrub",
      "original code/channel delivered by native BroadcastChannel",
    );
    await page.reload();
    await this.rejected(page);
    assert.deepEqual(await receiver.evaluate((state: Messages) => state.messages), [FINISH]);
    this.checks.push("reload cannot resend captured query");
    await page.goto(`${this.origin}/strava/finish?channel=invalid&code=${CODE}`);
    await this.rejected(page);
    assert.deepEqual(await receiver.evaluate((state: Messages) => state.messages), [FINISH]);
    this.checks.push("invalid channel rejected after scrub");
    await context.close();
  }
}

async function verifyBuiltFinish(): Promise<readonly string[]> {
  const evidence = await mkdtemp(
    join(process.env["STRAVA_SCRUB_EVIDENCE"] ?? tmpdir(), "strava-scrub-correction-"),
  );

  const dist = join(evidence, "dist");

  await build({ root: resolve(import.meta.dirname, ".."), build: { outDir: dist } });

  const server = await startServer(dist);

  try {
    const browser = await chromium.launch({ headless: true });
    const probe = new FinishProbe(browser, server.origin);

    try {
      await probe.blocked();
      await probe.loaded();

      return probe.checks;
    } finally {
      await browser.close();
      await writeFile(
        join(evidence, "receipt.json"),
        JSON.stringify(
          {
            dist,
            blockedAssetQuery: probe.blockedAssetQuery,
            requests: probe.requests,
            networkRequests: probe.networkRequests,
            checks: probe.checks,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await server.close();
  }
}

it("scrubs the built finish URL before scripts, even when bootstrap assets fail", async () => {
  expect(await verifyBuiltFinish()).toContain("query scrubbed with every external script blocked");
}, 30000);
