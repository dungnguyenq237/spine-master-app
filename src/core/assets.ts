import type { Asset, AssetFile } from "./contracts";
import { readAsset } from "../native/bridge";
import { binaryVersion, jsonVersion, runtimeKey } from "./version";
export function relativePath(base: string, child: string): string {
  if (/^[\\/]|^[a-z]:/i.test(child))
    throw new Error("Absolute atlas page paths are forbidden.");
  const parts = base.split("/").slice(0, -1);
  for (const part of child.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Atlas page escapes its root.");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
export function groupAssets(files: readonly AssetFile[]): Asset[] {
  return files
    .filter((f) => /\.(json|skel)$/i.test(f.path))
    .map((skeleton) => {
      const stem = skeleton.path.replace(/\.(json|skel)$/i, "");
      const atlases = files.filter(
        (f) => f.root === skeleton.root && f.path === `${stem}.atlas`,
      );
      return {
        id: `${skeleton.root}/${skeleton.path}`,
        name: stem.split("/").at(-1)!,
        skeleton,
        atlas: atlases.length === 1 ? atlases[0]! : null,
        files,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function atlasPages(text: string): string[] {
  const pages: string[] = [];
  let pageStart = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      pageStart = true;
      continue;
    }
    if (pageStart) {
      if (line.includes(":")) throw new Error("Malformed atlas page header.");
      pages.push(line);
      pageStart = false;
    }
  }
  if (!pages.length || new Set(pages).size !== pages.length)
    throw new Error("Empty atlas or duplicate page names.");
  return pages;
}
export interface LoadedAsset {
  asset: Asset;
  version: string;
  key: string;
  data: string | Uint8Array;
  atlas: string;
  images: Map<string, HTMLImageElement>;
  sourceMax: number;
  dispose(): void;
}
export async function loadAsset(asset: Asset): Promise<LoadedAsset> {
  if (!asset.atlas)
    throw new Error(`Missing exact atlas for ${asset.skeleton.path}.`);
  const [raw, atlasBytes] = await Promise.all([
    readAsset(asset.skeleton),
    readAsset(asset.atlas),
  ]);
  const binary = /\.skel$/i.test(asset.skeleton.path);
  const data = binary ? new Uint8Array(raw) : new TextDecoder().decode(raw);
  const version =
    typeof data === "string" ? jsonVersion(data) : binaryVersion(data);
  const key = runtimeKey(version),
    atlas = new TextDecoder().decode(atlasBytes);
  const images = new Map<string, HTMLImageElement>();
  const urls: string[] = [];
  let sourceMax = 0,
    pixels = 0;
  const dispose = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    for (const image of images.values()) image.src = "";
    images.clear();
  };
  try {
    for (const page of atlasPages(atlas)) {
      const path = relativePath(asset.atlas.path, page);
      const matches = asset.files.filter(
        (f) => f.root === asset.skeleton.root && f.path === path,
      );
      if (matches.length !== 1)
        throw new Error(`Missing or ambiguous atlas page: ${path}`);
      const bytes = await readAsset(matches[0]!);
      const view = new DataView(bytes);
      if (
        bytes.byteLength < 24 ||
        view.getUint32(0) !== 0x89504e47 ||
        view.getUint32(4) !== 0x0d0a1a0a
      )
        throw new Error(`Only PNG atlas textures are supported: ${path}`);
      const w = view.getUint32(16),
        h = view.getUint32(20);
      pixels += w * h;
      if (!w || !h || w > 16384 || h > 16384 || pixels > 64 * 1024 * 1024)
        throw new Error(
          "Texture allocation budget exceeded (64 megapixels per asset).",
        );
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      urls.push(url);
      const image = new Image();
      image.src = url;
      await image.decode();
      images.set(page, image);
      sourceMax = Math.max(sourceMax, w, h);
    }
    return { asset, version, key, data, atlas, images, sourceMax, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
