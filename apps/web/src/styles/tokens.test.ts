import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

type Rgb = readonly [red: number, green: number, blue: number];

interface AlphaColor {
  readonly rgb: Rgb;
  readonly alpha: number;
}

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function token(name: string): string {
  const value = new RegExp(`${name}:\\s*([^;]+);`, "u").exec(css)?.[1]?.trim();

  if (value === undefined) throw new Error(`Missing CSS token ${name}`);

  return value;
}

function parseHexColor(value: string): AlphaColor {
  const match = /^#([\da-f]{6})([\da-f]{2})?$/iu.exec(value);

  if (match === null) throw new Error(`Unsupported CSS color ${value}`);

  const digits = match[1];

  if (digits === undefined) throw new Error(`Missing CSS color channels ${value}`);

  const alpha = match[2];

  return {
    rgb: [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ],
    alpha: alpha === undefined ? 1 : Number.parseInt(alpha, 16) / 255,
  };
}

function rgb(value: string): Rgb {
  return parseHexColor(value).rgb;
}

function composite(foreground: AlphaColor, background: Rgb): Rgb {
  const alpha = foreground.alpha;

  return [
    Math.round(foreground.rgb[0] * alpha + background[0] * (1 - alpha)),
    Math.round(foreground.rgb[1] * alpha + background[1] * (1 - alpha)),
    Math.round(foreground.rgb[2] * alpha + background[2] * (1 - alpha)),
  ];
}

function luminance([red, green, blue]: Rgb): number {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  const [redLinear, greenLinear, blueLinear] = linear;

  if (redLinear === undefined || greenLinear === undefined || blueLinear === undefined)
    throw new Error("Missing luminance channel");

  return 0.2126 * redLinear + 0.7152 * greenLinear + 0.0722 * blueLinear;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

it("keeps primary and muted text readable on every glass and solid surface", () => {
  const glass = parseHexColor(token("--surface-glass"));
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];

  const surfaces: readonly (readonly [string, Rgb])[] = [
    ["glass over black", composite(glass, black)],
    ["glass over white", composite(glass, white)],
    ["solid", rgb(token("--surface-solid"))],
    ["raised", rgb(token("--surface-raised"))],
  ];

  for (const [, surface] of surfaces) {
    expect(contrast(rgb(token("--text-primary")), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(token("--text-muted")), surface)).toBeGreaterThanOrEqual(4.5);
  }
});

it("keeps action labels readable in default and hover states", () => {
  const onPrimary = rgb(token("--text-on-primary"));
  const primaryText = rgb(token("--text-primary"));

  for (const name of ["--action-primary", "--action-primary-hover"]) {
    expect(contrast(onPrimary, rgb(token(name)))).toBeGreaterThanOrEqual(4.5);
  }

  for (const name of [
    "--action-secondary",
    "--action-secondary-hover",
    "--action-danger",
    "--action-danger-hover",
  ]) {
    expect(contrast(primaryText, rgb(token(name)))).toBeGreaterThanOrEqual(4.5);
  }
});
