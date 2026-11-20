export interface Locator {
  readonly click: () => Promise<void>;
  readonly filter: (options: { readonly hasText: Readonly<RegExp> }) => Locator;
  readonly waitFor: () => Promise<void>;
}
export interface Cookie {
  readonly name: string;
  readonly httpOnly: boolean;
  readonly sameSite: string;
  readonly path: string;
}
export interface Route {
  readonly request: () => { readonly url: () => string };
  readonly abort: () => Promise<void>;
  readonly continue: () => Promise<void>;
}
export interface BrowserContext {
  readonly cookies: (url: string) => Promise<readonly Cookie[]>;
  readonly route: (pattern: string, handler: (route: Route) => Promise<void>) => Promise<void>;
  readonly newPage: () => Promise<Page>;
}
export interface Page {
  readonly goto: (url: string) => Promise<{ readonly ok: () => boolean } | null>;
  readonly locator: (selector: string) => Locator;
  readonly context: () => BrowserContext;
  readonly url: () => string;
}
export interface Browser {
  readonly newContext: () => Promise<BrowserContext>;
  readonly close: () => Promise<void>;
}
export const chromium: {
  readonly launch: (options: { readonly headless: boolean }) => Promise<Browser>;
};
