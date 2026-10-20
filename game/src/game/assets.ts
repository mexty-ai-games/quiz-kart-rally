/** Loads the asset kit (GLB models) once, from the URLs in the props: the karts plus a list of named models. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetUrls } from "./types";

export interface Kit {
  karts: (THREE.Group | null)[];
  models: { [id: string]: THREE.Group };
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
        const n = (s.name || "").toLowerCase();
        // emissive parts glow into the bloom; glass parts stay see-through without hiding what is behind
        if (n.indexOf("glow_") === 0 || /^lamp\d$/.test(n)) {
          if (!s.emissive || s.emissive.getHex() === 0) s.emissive = s.color.clone();
          s.emissiveIntensity = Math.max(s.emissiveIntensity || 1, 2.2);
          s.toneMapped = true;
        }
        if (n.indexOf("glass_") === 0) {
          s.transparent = true;
          s.depthWrite = false;
          if (s.opacity >= 1) s.opacity = 0.45;
          m.castShadow = false;
          m.renderOrder = 3;
        }
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
  const models = (urls?.models ?? []).filter((m) => m && m.id && m.url);
  const total = kartUrls.length + models.length;
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
  models.forEach((m) =>
    jobs.push(
      load(m.url).then((g) => {
        if (g) kit.models[m.id] = g;
      })
    )
  );
  pending = Promise.all(jobs).then(() => kit);
  return pending;
}

export function has(kit: Kit, id: string) {
  return !!kit.models[id];
}

/** First model of the list that the kit has. */
export function pick(kit: Kit, ids: string[]): string | null {
  for (let i = 0; i < ids.length; i++) if (kit.models[ids[i]]) return ids[i];
  return null;
}

export function cloneModel(kit: Kit, id: string | null): THREE.Object3D | null {
  if (!id) return null;
  const src = kit.models[id];
  return src ? src.clone(true) : null;
}

/**
 * Many copies of one model as InstancedMeshes (one draw call per mesh): trees, coins, tyre walls.
 * Returns the group and the meshes so per-instance matrices can be updated later.
 */
export function instanceModel(kit: Kit, id: string | null, mats: THREE.Matrix4[], shadows = true): { group: THREE.Group; meshes: THREE.InstancedMesh[]; locals: THREE.Matrix4[] } {
  const group = new THREE.Group();
  const meshes: THREE.InstancedMesh[] = [];
  const locals: THREE.Matrix4[] = [];
  const src = id ? kit.models[id] : null;
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
    im.castShadow = shadows && m.castShadow;
    im.receiveShadow = true;
    im.renderOrder = m.renderOrder;
    im.computeBoundingSphere();
    im.frustumCulled = false;
    group.add(im);
    meshes.push(im);
    locals.push(local);
  });
  return { group, meshes, locals };
}

/** Finds a node by exact name inside a model. */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && o.name === name) hit = o;
  });
  return hit;
}
