import type { Asset, Bounds } from "../core/contracts";
import type { LoadedAsset } from "../core/assets";
import { loadAsset } from "../core/assets";
import { loadRuntime } from "../runtime/registry";
import { SpineRenderer } from "../render/renderer";
import { required, message } from "./dom";
export class Preview {
  private renderer: SpineRenderer | null = null;
  private source: LoadedAsset | null = null;
  private raf = 0;
  private generation = 0;
  private playing = true;
  private time = 0;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private bounds: Bounds = { x: 0, y: 0, width: 200, height: 400 };
  private last = 0;
  private lastPaint = 0;
  private abort: AbortController | null = null;
  private focus: HTMLElement | null = null;
  private seekGeneration = 0;
  private seeking = false;
  private seekResume = true;
  readonly dialog: HTMLDialogElement;
  constructor(
    private onReady: (
      asset: Asset,
      renderer: SpineRenderer,
      source: LoadedAsset,
    ) => void,
  ) {
    this.dialog = required("#workspace");
    this.dialog.addEventListener("close", () => this.close());
    required("#closeWorkspace").onclick = () => this.dialog.close();
  }
  get animation(): string {
    return required<HTMLSelectElement>("#animation").value;
  }
  get skin(): string {
    return required<HTMLSelectElement>("#skin").value;
  }
  get duration(): number {
    return Math.max(
      0.001,
      this.renderer?.data.animations.find((a) => a.name === this.animation)
        ?.duration ?? 1,
    );
  }
  async open(asset: Asset): Promise<void> {
    this.close();
    const generation = ++this.generation;
    this.focus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    required("#workspaceTitle").textContent = asset.name;
    required("#workspaceError").textContent = "Loading…";
    this.dialog.showModal();
    let source: LoadedAsset | null = null;
    let renderer: SpineRenderer | null = null;
    try {
      source = await loadAsset(asset);
      const runtime = await loadRuntime(source.key);
      if (generation !== this.generation) {
        source.dispose();
        return;
      }
      const canvas = document.createElement("canvas");
      required("#canvasWrap").replaceChildren(canvas);
      renderer = new SpineRenderer(canvas, runtime, source);
      this.renderer = renderer;
      this.source = source;
      for (const [id, names] of [
        ["animation", renderer.data.animations.map((a) => a.name)],
        ["skin", ["", ...renderer.data.skins.map((s) => s.name)]],
      ] as const) {
        const select = required<HTMLSelectElement>(`#${id}`);
        select.replaceChildren(
          ...names.map((n) => new Option(n || "Default", n)),
        );
      }
      this.abort = new AbortController();
      const signal = this.abort.signal;
      const reset = () => {
        this.seekGeneration++;
        this.renderer!.reset(this.animation, this.skin);
        this.time = 0;
        this.bounds = this.renderer!.bounds();
      };
      reset();
      required("#animation").addEventListener(
        "change",
        () => {
          if (this.seeking) {
            this.seeking = false;
            this.playing = this.seekResume;
          }
          reset();
          this.onReady(asset, this.renderer!, this.source!);
        },
        { signal },
      );
      required("#skin").addEventListener(
        "change",
        () => {
          if (this.seeking) {
            this.seeking = false;
            this.playing = this.seekResume;
          }
          reset();
        },
        { signal },
      );
      required("#play").addEventListener(
        "click",
        () => {
          if (this.seeking) return;
          this.playing = !this.playing;
          required("#play").textContent = this.playing ? "Pause" : "Play";
        },
        { signal },
      );
      required<HTMLInputElement>("#timeline").addEventListener(
        "input",
        () => {
          const target =
            Number(required<HTMLInputElement>("#timeline").value) *
            this.duration;
          if (!this.seeking) this.seekResume = this.playing;
          this.seeking = true;
          this.playing = false;
          reset();
          const seekGeneration = this.seekGeneration;
          const activeRenderer = this.renderer!;
          void activeRenderer
            .advanceToAsync(target, 120, () => {
              if (
                seekGeneration !== this.seekGeneration ||
                generation !== this.generation
              )
                throw new DOMException("Seek superseded", "AbortError");
            })
            .then(() => {
              if (seekGeneration === this.seekGeneration) {
                this.time = target;
                this.seeking = false;
                this.playing = this.seekResume;
              }
            })
            .catch((error) => {
              if (
                seekGeneration === this.seekGeneration &&
                generation === this.generation
              ) {
                this.seeking = false;
                required("#workspaceError").textContent = message(error);
              }
            });
        },
        { signal },
      );
      required<HTMLInputElement>("#zoom").addEventListener(
        "input",
        () => {
          this.zoom = Number(required<HTMLInputElement>("#zoom").value);
        },
        { signal },
      );
      required("#fit").addEventListener(
        "click",
        () => {
          this.zoom = 1;
          this.pan = { x: 0, y: 0 };
          required<HTMLInputElement>("#zoom").value = "1";
        },
        { signal },
      );
      canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.zoom = Math.max(
            0.1,
            Math.min(10, this.zoom * Math.exp(-e.deltaY * 0.001)),
          );
          required<HTMLInputElement>("#zoom").value = String(this.zoom);
        },
        { passive: false, signal },
      );
      let pointer: { x: number; y: number } | null = null;
      canvas.addEventListener(
        "pointerdown",
        (e) => {
          pointer = { x: e.clientX, y: e.clientY };
          canvas.setPointerCapture(e.pointerId);
        },
        { signal },
      );
      canvas.addEventListener(
        "pointermove",
        (e) => {
          if (!pointer) return;
          const world =
            (Math.max(this.bounds.width, this.bounds.height) * 1.3) / this.zoom;
          this.pan.x -= ((e.clientX - pointer.x) * world) / canvas.clientHeight;
          this.pan.y += ((e.clientY - pointer.y) * world) / canvas.clientHeight;
          pointer = { x: e.clientX, y: e.clientY };
        },
        { signal },
      );
      canvas.addEventListener(
        "pointerup",
        () => {
          pointer = null;
        },
        { signal },
      );
      canvas.addEventListener(
        "pointercancel",
        () => {
          pointer = null;
        },
        { signal },
      );
      this.dialog.addEventListener(
        "keydown",
        (event) => {
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLSelectElement ||
            event.target instanceof HTMLTextAreaElement
          )
            return;
          if (event.key === "+" || event.key === "=")
            this.zoom = Math.min(10, this.zoom + 0.1);
          else if (event.key === "-" || event.key === "_")
            this.zoom = Math.max(0.1, this.zoom - 0.1);
          else if (event.key === "0") {
            this.zoom = 1;
            this.pan = { x: 0, y: 0 };
          } else return;
          event.preventDefault();
          required<HTMLInputElement>("#zoom").value = String(this.zoom);
        },
        { signal },
      );
      this.playing = true;
      required("#play").textContent = "Pause";
      required<HTMLInputElement>("#zoom").value = "1";
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.last = performance.now();
      this.lastPaint = 0;
      required("#workspaceError").textContent = "";
      this.onReady(asset, renderer, source);
      this.raf = requestAnimationFrame((t) => this.tick(t));
    } catch (error) {
      renderer?.dispose();
      source?.dispose();
      if (generation === this.generation) {
        this.renderer = null;
        this.source = null;
        required("#workspaceError").textContent = message(error);
      }
    }
  }
  private tick(now: number): void {
    if (!this.renderer) return;
    try {
      const fps = Number(required<HTMLSelectElement>("#previewFps").value),
        delta = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.playing) {
        this.time += delta;
        if (this.time > this.duration) {
          this.time %= this.duration;
          this.renderer.reset(this.animation, this.skin);
        }
        this.renderer.advanceTo(this.time, 120);
      }
      if (now - this.lastPaint >= 1000 / fps) {
        this.lastPaint = now;
        const wrap = required("#canvasWrap");
        const w = Math.max(2, wrap.clientWidth),
          h = Math.max(2, wrap.clientHeight),
          aspect = w / h;
        let height = (this.bounds.height * 1.3) / this.zoom,
          width = height * aspect;
        if (width < (this.bounds.width * 1.3) / this.zoom) {
          width = (this.bounds.width * 1.3) / this.zoom;
          height = width / aspect;
        }
        this.renderer.draw(
          w,
          h,
          {
            x: this.bounds.x + this.bounds.width / 2 - width / 2 + this.pan.x,
            y: this.bounds.y + this.bounds.height / 2 - height / 2 + this.pan.y,
            width,
            height,
          },
          "#0a0a14",
        );
        required<HTMLInputElement>("#timeline").value = String(
          this.time / this.duration,
        );
        required("#timeLabel").textContent =
          `${this.time.toFixed(2)} / ${this.duration.toFixed(2)} s`;
      }
      this.raf = requestAnimationFrame((t) => this.tick(t));
    } catch (error) {
      required("#workspaceError").textContent = message(error);
    }
  }
  close(): void {
    this.generation++;
    this.seekGeneration++;
    this.seeking = false;
    cancelAnimationFrame(this.raf);
    this.abort?.abort();
    this.renderer?.dispose();
    this.source?.dispose();
    this.renderer = null;
    this.source = null;
    this.focus?.focus();
  }
}
