/** Loads the asset kit (GLB models) once, from the URLs in the props. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetUrls } from "./types";

export type PropKey =
  | "itemBox"
  | "banana"
  | "coin"
  | "cone"
  | "tree"
  | "treePine"
  | "smoke"
  | "debrisTire"
  | "gantry"
  | "startArch"
  | "boostPad"
  | "tireWall"
  | "grandstand"
  | "flag";

export const PROP_KEYS: PropKey[] = ["itemBox", "banana", "coin", "cone", "tree", "treePine", "smoke", "debrisTire", "gantry", "startArch", "boostPad", "tireWall", "grandstand", "flag"];

export interface Kit {
  karts: (THREE.Group | null)[];
  models: Partial<Record<PropKey, THREE.Group>>;
}

let cacheKey = "";
let pending: Promise<Kit> | null = null;

function prep(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mt) => {
        const s = mt as THREE.MeshStandardMaterial;
        if (s.map) s.map.anisotropy = 4;
      });
    }
  });
}

export function loadKit(urls: AssetUrls | undefined, onProgress: (p: number) => void): Promise<Kit> {
  const key = JSON.stringify(urls ?? {});
  if (pending && key === cacheKey) return pending;
  cacheKey = key;
  const kit: Kit = { karts: [], models: {} };
  const loader = new GLTFLoader();
  loader.setCrossOrigin("anonymous");
  const kartUrls = (urls?.karts ?? []).slice(0, 8);
  const total = kartUrls.length + PROP_KEYS.length;
  let done = 0;
  const tick = () => {
    done++;
    onProgress(total ? done / total : 1);
  };
  const load = (u: string | undefined): Promise<THREE.Group | null> => {
    if (!u) {
      tick();
      return Promise.resolve(null);
    }
    return loader
      .loadAsync(u)
      .then((g) => {
        prep(g.scene);
        return g.scene;
      })
      .catch((e) => {
        console.warn("[Quiz Kart] model failed", u, e && e.message ? e.message : e);
        return null;
      })
      .then((g) => {
        tick();
        return g;
      });
  };
  const jobs: Promise<void>[] = [];
  kartUrls.forEach((u, i) =>
    jobs.push(
      load(u).then((g) => {
        kit.karts[i] = g;
      })
    )
  );
  PROP_KEYS.forEach((k) =>
    jobs.push(
      load(urls ? (urls as any)[k] : undefined).then((g) => {
        if (g) kit.models[k] = g;
      })
    )
  );
  pending = Promise.all(jobs).then(() => kit);
  return pending;
}

export function cloneModel(kit: Kit, k: PropKey): THREE.Object3D | null {
  const src = kit.models[k];
  return src ? src.clone(true) : null;
}

/**
 * Many copies of one model as InstancedMeshes (one draw call per mesh): trees, coins, tyre walls.
 * Returns the group and the meshes so per-instance matrices can be updated later.
 */
export function instanceModel(kit: Kit, k: PropKey, mats: THREE.Matrix4[], shadows = true): { group: THREE.Group; meshes: THREE.InstancedMesh[]; locals: THREE.Matrix4[] } {
  const group = new THREE.Group();
  const meshes: THREE.InstancedMesh[] = [];
  const locals: THREE.Matrix4[] = [];
  const src = kit.models[k];
  if (!src || !mats.length) return { group, meshes, locals };
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const im = new THREE.InstancedMesh(m.geometry, m.material, mats.length);
    const local = m.matrixWorld.clone();
    const tmp = new THREE.Matrix4();
    mats.forEach((M, i) => im.setMatrixAt(i, tmp.multiplyMatrices(M, local)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.frustumCulled = false;
    group.add(im);
    meshes.push(im);
    locals.push(local);
  });
  return { group, meshes, locals };
}
