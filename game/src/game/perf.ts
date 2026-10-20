/**
 * What kind of GPU is drawing the game. Used to pick the starting quality: the CPU core
 * count says nothing about the graphics chip (an 8-thread laptop often has Intel graphics).
 */
export interface GpuInfo {
  name: string;
  /** WebGL runs on the CPU (hardware acceleration off / blocked): everything must be minimal. */
  software: boolean;
  /** Integrated or mobile graphics: start on Low. */
  weak: boolean;
}

let cached: GpuInfo | null = null;

export function gpuInfo(): GpuInfo {
  if (cached) return cached;
  let name = "";
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    /* no WebGL here */
  }
  const s = name.toLowerCase();
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/.test(s);
  const integrated =
    /intel|mali|adreno|powervr|videocore|vivante|tegra|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/.test(s) && !/arc\(tm\)|\barc a\d/.test(s);
  cached = { name, software, weak: software || integrated };
  return cached;
}
