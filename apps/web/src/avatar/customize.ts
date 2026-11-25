import type { AvatarConfig } from "@voltonaut/shared";

import { createRiderModel, type RiderModel } from "./rider.js";

export interface AvatarPreview {
  readonly root: RiderModel["root"];
  readonly setLook: (config: AvatarConfig) => void;
  readonly dispose: () => void;
}

export function createAvatarPreview(wheelCircM: number): AvatarPreview {
  const model = createRiderModel(wheelCircM);
  model.posePreview();

  return {
    root: model.root,
    setLook: (config) => {
      model.setLook(config);
    },
    dispose: () => {
      model.dispose();
    },
  };
}
