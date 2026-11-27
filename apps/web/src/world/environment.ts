export const SECONDS_PER_DAY_S = 86_400;

export type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "storm";

export interface Direction {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EnvironmentState {
  readonly seed: number;
  readonly timeOfDayS: number;
  readonly weather: WeatherKind;
  readonly sunDirection: Direction;
  readonly sunIntensity: number;
  readonly fogDensity: number;
  readonly rainAmount: number;
}

export interface WeatherKeyframe {
  readonly startS: number;
  readonly weather: WeatherKind;
}

export type EnvironmentScript = readonly [WeatherKeyframe, ...WeatherKeyframe[]];

export interface EnvironmentSettings {
  readonly seed: number;
  readonly startTimeS: number;
  readonly script: EnvironmentScript;
}

interface WeatherPreset {
  readonly sunIntensity: number;
  readonly fogDensity: number;
  readonly rainAmount: number;
}

const WEATHER_PRESETS: Readonly<Record<WeatherKind, WeatherPreset>> = {
  clear: { sunIntensity: 3, fogDensity: 0.0015, rainAmount: 0 },
  cloudy: { sunIntensity: 1.2, fogDensity: 0.003, rainAmount: 0 },
  fog: { sunIntensity: 0.5, fogDensity: 0.012, rainAmount: 0 },
  rain: { sunIntensity: 0.45, fogDensity: 0.006, rainAmount: 0.7 },
  storm: { sunIntensity: 0.2, fogDensity: 0.008, rainAmount: 1 },
};

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = Object.freeze({
  seed: 42,
  startTimeS: 12 * 60 * 60,
  script: Object.freeze<EnvironmentScript>([Object.freeze({ startS: 0, weather: "clear" })]),
});

function normalizeTime(timeS: number): number {
  if (!Number.isFinite(timeS)) return 0;

  return ((timeS % SECONDS_PER_DAY_S) + SECONDS_PER_DAY_S) % SECONDS_PER_DAY_S;
}

function seededUnit(seed: number): number {
  let value = Number.isFinite(seed) ? Math.trunc(seed) : 0;

  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;

  return (value >>> 0) / 0x1_0000_0000;
}

function weatherAt(timeOfDayS: number, script: EnvironmentScript): WeatherKind {
  let selected = script[0];
  let selectedStartS = Number.NEGATIVE_INFINITY;

  for (const keyframe of script) {
    const startS = normalizeTime(keyframe.startS);

    if (startS <= timeOfDayS && startS >= selectedStartS) {
      selected = keyframe;
      selectedStartS = startS;
    }
  }

  return selected.weather;
}

export function environmentAt(
  seed: number,
  timeS: number,
  script: EnvironmentScript,
): EnvironmentState {
  const timeOfDayS = normalizeTime(timeS);
  const weather = weatherAt(timeOfDayS, script);
  const preset = WEATHER_PRESETS[weather];
  const seedVariation = seededUnit(seed);
  const solarPhase = (timeOfDayS / SECONDS_PER_DAY_S) * Math.PI * 2 - Math.PI / 2;
  const x = Math.cos(solarPhase);
  const y = Math.sin(solarPhase);
  const z = 0.35;
  const directionLength = Math.hypot(x, y, z);
  const daylight = Math.max(0, y);

  return Object.freeze({
    seed: Number.isFinite(seed) ? Math.trunc(seed) : 0,
    timeOfDayS,
    weather,
    sunDirection: Object.freeze({
      x: x / directionLength,
      y: y / directionLength,
      z: z / directionLength,
    }),
    sunIntensity: preset.sunIntensity * Math.sqrt(daylight),
    fogDensity: preset.fogDensity * (0.95 + seedVariation * 0.1),
    rainAmount: preset.rainAmount * (0.9 + seedVariation * 0.1),
  });
}

function parseWeatherKind(value: string | null): WeatherKind | undefined {
  if (value === null) return undefined;

  switch (value) {
    case "clear":
    case "cloudy":
    case "fog":
    case "rain":
    case "storm":
      return value;
    default:
      return undefined;
  }
}

interface EnvironmentQuery {
  readonly get: (name: string) => string | null;
}

function parseSeed(value: string | null, fallback: number): number {
  if (value === null || !/^-?\d+$/u.test(value)) return fallback;

  const seed = Number(value);

  return Number.isSafeInteger(seed) ? seed : fallback;
}

function parseTimeOfDay(value: string | null, fallback: number): number {
  if (value === null) return fallback;

  const match = /^(\d{2}):(\d{2})$/u.exec(value);

  if (match === null) return fallback;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return fallback;

  return hours * 60 * 60 + minutes * 60;
}

/**
 * Merges the URL parameters seed, time and weather over the given base
 * (DEFAULT_ENVIRONMENT_SETTINGS or a route's catalog default, #75). Every
 * missing or invalid parameter falls back per field, so a URL with only
 * weather=rain keeps the route's seed and start time.
 */
export function parseEnvironmentSettings(
  query: EnvironmentQuery,
  base: EnvironmentSettings = DEFAULT_ENVIRONMENT_SETTINGS,
): EnvironmentSettings {
  const rawWeather = query.get("weather");
  const weather = rawWeather === null ? undefined : parseWeatherKind(rawWeather);

  return {
    seed: parseSeed(query.get("seed"), base.seed),
    startTimeS: parseTimeOfDay(query.get("time"), base.startTimeS),
    script: weather === undefined ? base.script : [{ startS: 0, weather }],
  };
}
