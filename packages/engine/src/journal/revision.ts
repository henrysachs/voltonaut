/**
 * Physics revision this engine build computes. Journals and progress
 * checkpoints carry it; replay accepts only journals of this revision.
 * New engine semantics need a new revision (ADR-016).
 */
export const PHYSICS_REVISION = "engine-v1";
