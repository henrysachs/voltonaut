import { assert, constantFrom, integer, property } from "fast-check";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  environmentAt,
  parseEnvironmentSettings,
  SECONDS_PER_DAY_S,
  type EnvironmentScript,
  type WeatherKind,
} from "./environment.js";

const WEATHER: readonly WeatherKind[] = ["clear", "cloudy", "fog", "rain", "storm"];

function script(weather: WeatherKind): EnvironmentScript {
  return [{ startS: 0, weather }];
}

describe("deterministic environment state", () => {
  it("returns the same immutable snapshot for the same inputs", () => {
    const weatherScript = script("rain");

    const first = environmentAt(42, 43_200, weatherScript);
    const second = environmentAt(42, 43_200, weatherScript);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sunDirection)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ENVIRONMENT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ENVIRONMENT_SETTINGS.script)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ENVIRONMENT_SETTINGS.script[0])).toBe(true);
    expect(first).toMatchObject({
      seed: 42,
      timeOfDayS: 43_200,
      weather: "rain",
    });
    expect(environmentAt(43, 43_200, weatherScript).fogDensity).not.toBe(first.fogDensity);
    expect(environmentAt(7, 43_200, script("rain")).rainAmount).toBeCloseTo(0.6324159054, 10);
  });

  it("moves the sun above the horizon by day and below it at night", () => {
    const morning = environmentAt(42, 6 * 60 * 60, script("clear"));
    const noon = environmentAt(42, 12 * 60 * 60, script("clear"));
    const night = environmentAt(42, 0, script("clear"));

    expect(morning.sunDirection.y).toBeCloseTo(0);
    expect(noon.sunDirection.y).toBeGreaterThan(0.9);
    expect(noon.sunIntensity).toBeGreaterThan(2.5);
    expect(night.sunDirection.y).toBeLessThan(-0.9);
    expect(night.sunIntensity).toBe(0);
  });

  it("selects scheduled weather and wraps at the day boundary", () => {
    const weatherScript: EnvironmentScript = [
      { startS: 0, weather: "clear" },
      { startS: 6 * 60 * 60, weather: "rain" },
    ];

    expect(environmentAt(42, 5 * 60 * 60, weatherScript).weather).toBe("clear");
    expect(environmentAt(42, 7 * 60 * 60, weatherScript).weather).toBe("rain");
    expect(environmentAt(42, SECONDS_PER_DAY_S + 60, weatherScript).weather).toBe("clear");
    expect(environmentAt(42, -60, weatherScript).timeOfDayS).toBe(SECONDS_PER_DAY_S - 60);
  });
});

describe("weather script ordering", () => {
  it("selects the greatest normalized start time from an unsorted script", () => {
    const weatherScript: EnvironmentScript = [
      { startS: 6 * 60 * 60, weather: "rain" },
      { startS: 0, weather: "clear" },
      { startS: SECONDS_PER_DAY_S + 12 * 60 * 60, weather: "storm" },
    ];

    expect(environmentAt(42, 5 * 60 * 60, weatherScript).weather).toBe("clear");
    expect(environmentAt(42, 7 * 60 * 60, weatherScript).weather).toBe("rain");
    expect(environmentAt(42, 13 * 60 * 60, weatherScript).weather).toBe("storm");
  });

  it("uses the last script entry when normalized start times are duplicated", () => {
    const rainLast: EnvironmentScript = [
      { startS: 0, weather: "clear" },
      { startS: SECONDS_PER_DAY_S, weather: "rain" },
    ];

    const clearLast: EnvironmentScript = [
      { startS: SECONDS_PER_DAY_S, weather: "rain" },
      { startS: 0, weather: "clear" },
    ];

    expect(environmentAt(42, 43_200, rainLast).weather).toBe("rain");
    expect(environmentAt(42, 43_200, clearLast).weather).toBe("clear");
  });
});

describe("weather bounds", () => {
  it("bounds every weather state for arbitrary finite inputs", () => {
    assert(
      property(integer(), integer(), constantFrom(...WEATHER), (seed, timeS, weather) => {
        const state = environmentAt(seed, timeS, script(weather));

        expect(Number.isFinite(state.timeOfDayS)).toBe(true);
        expect(state.timeOfDayS).toBeGreaterThanOrEqual(0);
        expect(state.timeOfDayS).toBeLessThan(SECONDS_PER_DAY_S);
        expect(
          Math.hypot(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z),
        ).toBeCloseTo(1);
        expect(state.sunIntensity).toBeGreaterThanOrEqual(0);
        expect(state.sunIntensity).toBeLessThanOrEqual(3);
        expect(state.fogDensity).toBeGreaterThan(0);
        expect(state.fogDensity).toBeLessThan(0.02);
        expect(state.rainAmount).toBeGreaterThanOrEqual(0);
        expect(state.rainAmount).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("increases fog and rain from clear weather to storm", () => {
    const clear = environmentAt(42, 43_200, script("clear"));
    const cloudy = environmentAt(42, 43_200, script("cloudy"));
    const fog = environmentAt(42, 43_200, script("fog"));
    const rain = environmentAt(42, 43_200, script("rain"));
    const storm = environmentAt(42, 43_200, script("storm"));

    expect(clear.rainAmount).toBe(0);
    expect(cloudy.rainAmount).toBe(0);
    expect(fog.fogDensity).toBeGreaterThan(cloudy.fogDensity);
    expect(rain.rainAmount).toBeGreaterThan(0);
    expect(storm.rainAmount).toBeGreaterThan(rain.rainAmount);
    expect(storm.fogDensity).toBeGreaterThan(rain.fogDensity);
    expect(clear.sunIntensity).toBeGreaterThan(storm.sunIntensity);
  });
});

describe("environment query boundary", () => {
  it("parses deterministic scene parameters", () => {
    const settings = parseEnvironmentSettings(
      new URLSearchParams("seed=7&time=18:30&weather=storm"),
    );

    expect(settings).toEqual({
      seed: 7,
      startTimeS: 18 * 60 * 60 + 30 * 60,
      script: [{ startS: 0, weather: "storm" }],
    });
  });

  it("falls back per field without discarding valid parameters", () => {
    expect(parseEnvironmentSettings(new URLSearchParams("seed=7&time=24:00&weather=rain"))).toEqual(
      {
        seed: 7,
        startTimeS: DEFAULT_ENVIRONMENT_SETTINGS.startTimeS,
        script: [{ startS: 0, weather: "rain" }],
      },
    );
  });

  it("uses defaults for missing or invalid parameters", () => {
    expect(parseEnvironmentSettings(new URLSearchParams())).toEqual(DEFAULT_ENVIRONMENT_SETTINGS);

    for (const query of ["seed=NaN", "time=24:00", "time=12:60", "weather=wind"]) {
      expect(parseEnvironmentSettings(new URLSearchParams(query))).toEqual(
        DEFAULT_ENVIRONMENT_SETTINGS,
      );
    }
  });
});
