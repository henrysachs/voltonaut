import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE, type RideEvent, type RideMode } from "@voltonaut/shared";

import { KOM_CLIMB } from "../elevation/data/kom-climb.js";
import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute } from "../elevation/route.js";
import { nextRandom, pickItem } from "../fun/rng.js";
import { createEngine, type Engine } from "./engine.js";

const route = createRoute(TEST_LOOP);
const climb = createRoute(KOM_CLIMB);

/** Seed whose first item is aeroBoost (mulberry32(7) = 0.0117). */
const AERO_SEED = 7;

function engineAt(
  routePosM: number,
  mode: RideMode = "fun",
  seed = 42,
  onRoute = route,
  speedMps = 10,
): Engine {
  return createEngine({
    route: onRoute,
    profile: DEFAULT_RIDER_PROFILE,
    initialRoutePosM: routePosM,
    initialSpeedMps: speedMps,
    mode,
    seed,
  });
}

/** Rides in 0.5 s steps with fresh trainer data; returns every drained event. */
function ride(engine: Readonly<Engine>, seconds: number, powerW = 250): readonly RideEvent[] {
  const events: RideEvent[] = [];

  for (let tS = 0; tS < seconds; tS += 0.5) {
    engine.ingest({ type: "trainer.data", tS, powerW, cadenceRpm: powerW > 0 ? 90 : 0 });
    engine.advance(0.5);
    events.push(...engine.drainEvents());
  }

  return events;
}

/** Remaining effect seconds; -1 when the snapshot has no fun view. */
function remainingS(engine: Readonly<Engine>): number {
  return engine.snapshot().fun?.activeRemainingS ?? -1;
}

function press(engine: Readonly<Engine>): void {
  engine.ingest({
    type: "controller.button",
    tS: 0,
    button: "powerUp",
    pressed: true,
    source: "t",
  });
}

function itemEvents(events: readonly RideEvent[]): readonly string[] {
  return events.flatMap((event) =>
    event.type.startsWith("item.") && "item" in event ? [`${event.type}:${event.item}`] : [],
  );
}

/** Rides from just before the 300 m box until it is collected. */
function collected(seed = 42, onRoute = route, speedMps = 10): Engine {
  const engine = engineAt(290, "fun", seed, onRoute, speedMps);

  ride(engine, 3);

  return engine;
}

it("normal mode never collects items or emits item events", () => {
  const engine = engineAt(290, "normal");

  press(engine);
  expect(itemEvents(ride(engine, 5))).toEqual([]);
  expect(engine.snapshot().fun).toBeUndefined();
});

it("fun mode collects an item when crossing a box", () => {
  const engine = engineAt(290);

  expect(itemEvents(ride(engine, 3))).toEqual(["item.collected:featherweight"]);
  expect(engine.snapshot().fun).toEqual({
    heldItem: "featherweight",
    activeItem: undefined,
    activeRemainingS: 0,
  });
});

it("a full slot ignores the next box", () => {
  const engine = collected();

  expect(itemEvents(ride(engine, 90))).toEqual([]);
  expect(engine.snapshot().routePosM).toBeGreaterThan(1100);
});

it("powerUp activates the held item once, even on a double press", () => {
  const engine = collected();

  press(engine);
  press(engine);
  expect(itemEvents(ride(engine, 0.5))).toEqual(["item.activated:featherweight"]);
  expect(engine.snapshot().fun).toMatchObject({
    heldItem: undefined,
    activeItem: "featherweight",
  });
  press(engine);
  expect(itemEvents(ride(engine, 0.5))).toEqual([]);
});

it("the effect expires after its duration and emits item.expired", () => {
  const engine = collected();

  press(engine);
  ride(engine, 0.5);
  expect(itemEvents(ride(engine, 19))).toEqual([]);
  expect(itemEvents(ride(engine, 1))).toEqual(["item.expired:featherweight"]);
  expect(engine.snapshot().fun?.activeItem).toBeUndefined();
});

it("paused ticks do not consume effect time", () => {
  // 8 % at the 300 m box: the rider stops within seconds once pedaling ends.
  const engine = collected(42, climb, 4);

  press(engine);
  ride(engine, 0.5);
  ride(engine, 12, 0);
  expect(engine.snapshot().paused).toBe(true);

  const pausedRemainingS = remainingS(engine);

  ride(engine, 10, 0);
  expect(remainingS(engine)).toBe(pausedRemainingS);
  expect(pausedRemainingS).toBeGreaterThan(0);
});

it("an active aeroBoost makes the rider faster at equal power", () => {
  const boosted = collected(AERO_SEED);
  const plain = collected(AERO_SEED);

  expect(boosted.snapshot().fun?.heldItem).toBe("aeroBoost");

  press(boosted);
  ride(boosted, 15);
  ride(plain, 15);
  expect(boosted.snapshot().distanceM).toBeGreaterThan(plain.snapshot().distanceM + 1);
});

it("switching to normal clears items and restores params", () => {
  const engine = collected();

  press(engine);
  ride(engine, 0.5);
  engine.setMode("normal");
  ride(engine, 0.5);
  expect(engine.snapshot().fun).toBeUndefined();
  engine.setMode("fun");
  ride(engine, 0.5);
  expect(engine.snapshot().fun).toEqual({
    heldItem: undefined,
    activeItem: undefined,
    activeRemainingS: 0,
  });
});

/** Collects and immediately uses every box; 1000 W keeps two laps short in simulated time. */
function itemSequence(seed: number, seconds: number): readonly string[] {
  const engine = engineAt(290, "fun", seed);
  const sequence: string[] = [];

  for (let elapsedS = 0; elapsedS < seconds; elapsedS += 30) {
    sequence.push(
      ...itemEvents(ride(engine, 30, 1000)).filter((event) => event.includes("collected")),
    );
    press(engine);
  }

  return sequence;
}

/** The first picks of the seeded generator, as collection events. */
function seededPicks(seed: number, count: number): readonly string[] {
  let state = seed;

  return Array.from({ length: count }, () => {
    const draw = nextRandom(state);

    state = draw.state;

    return `item.collected:${pickItem(draw.value)}`;
  });
}

it("collects items in exactly the seeded order over two laps", () => {
  const sequence = itemSequence(42, 1500);

  expect(sequence.length).toBeGreaterThanOrEqual(20);
  expect(sequence).toEqual(seededPicks(42, sequence.length));
});
