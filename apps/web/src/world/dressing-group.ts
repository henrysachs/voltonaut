import * as THREE from "three";

/** What a region's dressing draws: meshes (instanced or not), points and lines, never a light. */
export type Drawable = THREE.Mesh | THREE.Points | THREE.LineSegments;

/**
 * How one instance of a prop meets the ground (dressing-ground.test.ts): it stands on the terrain
 * outside all water, or it is carried by a standing part of the same prop (crowns, fronds, lamp
 * heads, board frames).
 */
export type PartRole = "stands" | "carried";

export type Footing =
  /** Lake and sea surfaces and what floats on them. */
  | { readonly kind: "water" }
  /** Roles repeat instance by instance, one cycle per prop (a billboard: frame, post, post). */
  | { readonly kind: "prop"; readonly roles: readonly [PartRole, ...PartRole[]] }
  /**
   * Overlays that follow the road ribbon's own support points within the shoulder band (lamp
   * light), so they lie on the road, not on the terrain the ground probe checks.
   */
  | { readonly kind: "road" };

export const WATER: Footing = { kind: "water" };
export const STANDS: Footing = { kind: "prop", roles: ["stands"] };
export const CARRIED: Footing = { kind: "prop", roles: ["carried"] };
export const ROAD: Footing = { kind: "road" };

/**
 * A group of region dressing. It takes drawables only with their footing, and other dressing
 * groups, so no light can join a region's dressing: one region's light would light the whole
 * scene (#174). Scene lights come from the biome atmosphere (biome-atmosphere.ts).
 */
export class DressingGroup extends THREE.Group {
  private readonly footings = new Map<THREE.Object3D, Footing>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph takes ownership of the mutable child groups.
  override add(...groups: DressingGroup[]): this {
    // One child per call: Three's add() with no argument logs an error.
    for (const group of groups) super.add(group);

    return this;
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph takes ownership of the mutable child group.
  override attach(group: DressingGroup): this {
    return super.attach(group);
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph takes ownership of the mutable drawables.
  place(footing: Footing, ...parts: Drawable[]): this {
    for (const part of parts) {
      this.footings.set(part, footing);
      super.add(part);
    }

    return this;
  }

  /** The footing a child was placed with; undefined for anything that bypassed `place`. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The lookup keys on the mutable Three child's identity.
  footingOf(part: THREE.Object3D): Footing | undefined {
    return this.footings.get(part);
  }
}
