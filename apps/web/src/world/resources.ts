import * as THREE from "three";

interface DisposableResource {
  readonly dispose: () => void;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Disposal mutates the owned Three scene graph.
export function disposeObject(root: Readonly<THREE.Object3D>): void {
  const geometries = new Set<DisposableResource>();
  const materials = new Set<DisposableResource>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three invokes traversal with its mutable Object3D contract.
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      object.dispose();
    }

    if (object instanceof THREE.Mesh) {
      if (object.geometry instanceof THREE.BufferGeometry) {
        geometries.add(object.geometry);
      }

      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];

      for (const material of meshMaterials) {
        if (material instanceof THREE.Material) {
          materials.add(material);
        }
      }
    }
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }

  for (const material of materials) {
    material.dispose();
  }

  root.removeFromParent();
}
