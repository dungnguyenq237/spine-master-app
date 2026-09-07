import type { Runtime } from "./types";
interface ManifestEntry {
  version: string;
  file: string;
  sha256: string;
  global: string;
}
const loaded = new Map<string, Promise<Runtime>>();
export function loadRuntime(key: string): Promise<Runtime> {
  let pending = loaded.get(key);
  if (pending) return pending;
  pending = (async () => {
    const official =
      key === "4.0"
        ? await import("spine40")
        : key === "4.1"
          ? await import("spine41")
          : key === "4.2"
            ? await import("spine42")
            : key === "4.3"
              ? await import("spine43")
              : null;
    if (official) {
      const runtime = {
        ...official,
        webgl: official,
        apiVersion: key,
      } as unknown as Runtime;
      if (key !== "4.3")
        runtime.webgl.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
      return runtime;
    }
    const response = await fetch("/runtimes/manifest.json");
    if (!response.ok)
      throw new Error(
        `Runtime ${key} is not provisioned. See docs/RUNTIMES.md.`,
      );
    const manifest: unknown = await response.json();
    if (!Array.isArray(manifest)) throw new Error("Invalid runtime manifest.");
    const entry = manifest.find((value: unknown): value is ManifestEntry =>
      Boolean(
        value &&
          typeof value === "object" &&
          "version" in value &&
          value.version === key,
      ),
    ) as ManifestEntry | undefined;
    if (
      !entry ||
      !/^spine-[\d_]+\.js$/.test(entry.file) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entry.global !== `spine_${key.replace(".", "_")}`
    )
      throw new Error(`No reviewed runtime bundle for Spine ${key}.`);
    const script = document.createElement("script");
    script.src = `/runtimes/${entry.file}`;
    script.integrity = `sha256-${btoa(String.fromCharCode(...entry.sha256.match(/../g)!.map((h) => parseInt(h, 16))))}`;
    script.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error(`Runtime ${key} missing or integrity check failed.`));
      document.head.append(script);
    });
    const value: unknown = (window as unknown as Record<string, unknown>)[
      entry.global
    ];
    if (!value || typeof value !== "object")
      throw new Error("Runtime global missing.");
    for (const field of [
      "Skeleton",
      "SkeletonJson",
      "SkeletonBinary",
      "TextureAtlas",
      "AtlasAttachmentLoader",
      "AnimationState",
      "AnimationStateData",
    ])
      if (typeof (value as Record<string, unknown>)[field] !== "function")
        throw new Error(`Runtime missing ${field}.`);
    const runtime = value as Runtime;
    if (!runtime.webgl?.SceneRenderer || !runtime.webgl.GLTexture)
      throw new Error("Runtime must include official WebGL backend.");
    runtime.webgl.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
    return runtime;
  })();
  loaded.set(key, pending);
  void pending.catch(() => loaded.delete(key));
  return pending;
}
