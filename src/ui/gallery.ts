import type { Asset } from "../core/contracts";
import { loadAsset } from "../core/assets";
import { loadRuntime } from "../runtime/registry";
import { SpineRenderer } from "../render/renderer";
import { cacheGet, cachePut } from "../native/bridge";
import { element, message } from "./dom";
interface Card {
  asset: Asset;
  button: HTMLButtonElement;
  image: HTMLImageElement;
  meta: HTMLElement;
  visible: boolean;
  urls: string[];
  timer: ReturnType<typeof setInterval> | null;
  generation: number;
}
export class Gallery {
  private cards: Card[] = [];
  private rendering = false;
  private paused = false;
  private zoom = 1;
  private observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const c = this.cards.find((c) => c.button === e.target);
        if (c) {
          c.visible = e.isIntersecting;
          if (!c.visible) this.release(c);
        }
      }
      void this.pump();
    },
    { rootMargin: "0px" },
  );
  constructor(
    private root: HTMLElement,
    private open: (asset: Asset) => void,
  ) {}
  setAssets(assets: Asset[]): void {
    this.observer.disconnect();
    for (const c of this.cards) this.release(c);
    this.cards = [];
    this.root.replaceChildren();
    for (const asset of assets) {
      const button = element("button", "card");
      button.type = "button";
      const preview = element("div", "card-preview");
      const image = element("img");
      image.alt = asset.name;
      preview.append(image);
      const info = element("div", "card-info"),
        title = element("div", "card-name", asset.name),
        meta = element("div", "card-meta", asset.skeleton.path);
      info.append(title, meta);
      button.append(preview, info);
      button.onclick = () => this.open(asset);
      const card: Card = {
        asset,
        button,
        image,
        meta,
        visible: false,
        urls: [],
        timer: null,
        generation: 0,
      };
      this.cards.push(card);
      this.root.append(button);
      this.observer.observe(button);
    }
    if (!assets.length)
      this.root.append(
        element(
          "div",
          "empty",
          "Choose folders or drop them here to load Spine assets.",
        ),
      );
  }
  filter(value: string): void {
    for (const c of this.cards) {
      c.button.hidden =
        !`${c.asset.name} ${c.asset.skeleton.path} ${c.meta.textContent}`
          .toLowerCase()
          .includes(value.toLowerCase());
      if (c.button.hidden) this.release(c);
    }
    void this.pump();
  }
  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const c of this.cards) this.release(c);
    void this.pump();
  }
  pause(paused: boolean): void {
    this.paused = paused;
    for (const c of this.cards) {
      if (!paused) {
        this.release(c);
        continue;
      }
      c.generation++;
      if (c.timer) clearInterval(c.timer);
      c.timer = null;
      const first = c.urls[0];
      for (const url of c.urls.slice(1)) URL.revokeObjectURL(url);
      c.urls = first ? [first] : [];
      if (first) c.image.src = first;
    }
    if (!paused) void this.pump();
  }
  private release(c: Card): void {
    c.generation++;
    if (c.timer) clearInterval(c.timer);
    c.timer = null;
    for (const url of c.urls) URL.revokeObjectURL(url);
    c.urls = [];
    c.image.removeAttribute("src");
  }
  private async key(c: Card): Promise<string> {
    const manifest = await fetch("/runtimes/manifest.json").then((r) =>
      r.text(),
    );
    const metadata = c.asset.files
      .filter((f) => f.root === c.asset.skeleton.root)
      .map((f) => [f.path, f.size, f.modified]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([
          c.asset.skeleton.path,
          metadata,
          manifest,
          this.zoom,
          "preview-v3-spine40.31-41.56-42.120-43.13",
        ]),
      ),
    );
    return [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  }
  private async pump(): Promise<void> {
    if (this.rendering || this.paused) return;
    this.rendering = true;
    try {
      for (const c of this.cards) {
        if (!c.visible || c.button.hidden || c.urls.length || this.paused)
          continue;
        const generation = c.generation;
        let source: Awaited<ReturnType<typeof loadAsset>> | null = null;
        let renderer: SpineRenderer | null = null;
        try {
          const key = await this.key(c);
          try {
            const cached = await cacheGet(key);
            if (c.generation === generation) {
              const url = URL.createObjectURL(
                new Blob([cached], { type: "image/webp" }),
              );
              c.urls.push(url);
              c.image.src = url;
            }
          } catch {
            /* Cache misses regenerate from source. */
          }
          if (c.generation !== generation || this.paused) continue;
          source = await loadAsset(c.asset);
          const runtime = await loadRuntime(source.key);
          if (c.generation !== generation || this.paused) continue;
          renderer = new SpineRenderer(
            document.createElement("canvas"),
            runtime,
            source,
          );
          const anim = renderer.data.animations[0];
          c.meta.textContent = `${source.version} · ${renderer.data.animations.map((a) => a.name).join(", ") || "Setup pose"}`;
          renderer.reset(anim?.name ?? "", "");
          const bounds = renderer.bounds(),
            edge = Math.max(bounds.width, bounds.height) * this.zoom * 1.2;
          const camera = {
            x: bounds.x + bounds.width / 2 - edge / 2,
            y: bounds.y + bounds.height / 2 - edge / 2,
            width: edge,
            height: edge,
          };
          for (let i = 0; i < 12; i++) {
            if (c.generation !== generation || !c.visible || this.paused) break;
            renderer.advanceTo(((anim?.duration ?? 0) * i) / 12, 120);
            renderer.draw(256, 256, camera, "#0a0a14");
            const blob = await new Promise<Blob>((resolve, reject) =>
              renderer!.canvas.toBlob(
                (b) =>
                  b
                    ? resolve(b)
                    : reject(new Error("Thumbnail encoding failed")),
                "image/webp",
                0.6,
              ),
            );
            if (c.generation !== generation || this.paused) break;
            const url = URL.createObjectURL(blob);
            c.urls.push(url);
            if (i === 0) {
              c.image.src = url;
              void cachePut(
                key,
                new Uint8Array(await blob.arrayBuffer()),
              ).catch(() => undefined);
            }
            await new Promise((r) => setTimeout(r, 0));
          }
          if (
            c.generation === generation &&
            c.urls.length > 1 &&
            !this.paused
          ) {
            let index = 0;
            c.timer = setInterval(() => {
              index = (index + 1) % c.urls.length;
              c.image.src = c.urls[index]!;
            }, 80);
          }
        } catch (error) {
          c.meta.textContent = message(error);
          c.button.classList.add("has-error");
        } finally {
          renderer?.dispose();
          source?.dispose();
        }
      }
    } finally {
      this.rendering = false;
    }
  }
}
