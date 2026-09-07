import type { Bounds, ExportSettings } from "../core/contracts";
import type { LoadedAsset } from "../core/assets";
import type {
  Runtime,
  ManagedContext,
  SceneRenderer,
  Atlas,
  Disposable,
  SkeletonData,
  Skeleton,
  AnimationState,
} from "../runtime/types";
export class SpineRenderer {
  readonly context: ManagedContext;
  readonly scene: SceneRenderer;
  readonly gl: WebGLRenderingContext;
  readonly data: SkeletonData;
  private atlas: Atlas;
  private textures = new Set<Disposable>();
  private skeleton: Skeleton;
  private state: AnimationState;
  private time = 0;
  private pma: boolean;
  private disposed = false;
  private readbackCanvas = document.createElement("canvas");
  constructor(
    readonly canvas: HTMLCanvasElement,
    private runtime: Runtime,
    source: LoadedAsset,
  ) {
    this.context = new runtime.webgl.ManagedWebGLRenderingContext(canvas, {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    this.gl = this.context.gl;
    this.scene = new runtime.webgl.SceneRenderer(canvas, this.context);
    const texture = (name: string, pma = false): Disposable => {
      const image = source.images.get(name);
      if (!image) throw new Error(`Missing exact atlas image: ${name}`);
      if (
        Math.max(image.width, image.height) >
        this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
      )
        throw new Error("Atlas exceeds GPU texture limit.");
      const raw = new runtime.webgl.GLTexture(
        this.context,
        image,
        runtime.apiVersion === "4.3" ? pma : false,
      );
      this.textures.add(raw);
      return raw;
    };
    try {
      this.atlas = new runtime.TextureAtlas(source.atlas.trimStart(), texture);
      for (const page of this.atlas.pages)
        if (!page.texture) {
          const t = texture(page.name, Boolean(page.pma));
          if (page.setTexture) page.setTexture(t);
          else page.texture = t;
        }
      const pagePma = this.atlas.pages.map((p) => Boolean(p.pma));
      if (
        runtime.apiVersion !== "4.3" &&
        pagePma.some(Boolean) &&
        pagePma.some((v) => !v)
      )
        throw new Error(
          "Mixed PMA atlas pages are not supported by this adapter.",
        );
      this.pma =
        pagePma.some(Boolean) ||
        /(?:^|\n)\s*pma\s*:\s*true\b/i.test(source.atlas);
      const loader = new runtime.AtlasAttachmentLoader(this.atlas);
      this.data =
        typeof source.data === "string"
          ? new runtime.SkeletonJson(loader).readSkeletonData(
              JSON.parse(source.data) as unknown,
            )
          : new runtime.SkeletonBinary(loader).readSkeletonData(source.data);
      this.skeleton = new runtime.Skeleton(this.data);
      const stateData = new runtime.AnimationStateData(this.data);
      stateData.defaultMix = 0;
      this.state = new runtime.AnimationState(stateData);
      this.reset("", "");
    } catch (error) {
      for (const t of this.textures) t.dispose();
      this.scene.dispose();
      this.context.dispose();
      throw error;
    }
  }
  private setupPose(): void {
    if (this.runtime.apiVersion === "4.3") this.skeleton.setupPose!();
    else this.skeleton.setToSetupPose!();
  }
  reset(animation: string, skin: string): void {
    // A new skeleton resets physics, constraints and other mutable runtime state.
    this.skeleton = new this.runtime.Skeleton(this.data);
    this.setupPose();
    if (skin) {
      if (this.runtime.apiVersion === "4.3") {
        this.skeleton.setSkin!(skin);
        this.skeleton.setupPoseSlots!();
      } else {
        this.skeleton.setSkinByName!(skin);
        this.skeleton.setSlotsToSetupPose!();
      }
    }
    this.state.clearTracks();
    if (animation) {
      if (!this.data.animations.some((a) => a.name === animation))
        throw new Error(`Unknown animation: ${animation}`);
      this.state.setAnimation(0, animation, false);
    }
    this.time = 0;
    this.state.update(0);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform(this.runtime.Physics?.reset);
  }
  advanceTo(target: number, simulationFps: number): void {
    if (target < this.time - 1e-8)
      throw new Error(
        "Sequential renderer cannot seek backwards without resetting.",
      );
    const step = 1 / simulationFps;
    while (this.time < target - 1e-9) {
      const delta = Math.min(step, target - this.time);
      this.skeleton.update?.(delta);
      this.state.update(delta);
      this.state.apply(this.skeleton);
      this.skeleton.updateWorldTransform(this.runtime.Physics?.update);
      this.time += delta;
    }
  }
  async advanceToAsync(
    target: number,
    simulationFps: number,
    check: () => void,
  ): Promise<void> {
    while (target - this.time > 1) {
      check();
      this.advanceTo(this.time + 1, simulationFps);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    check();
    this.advanceTo(target, simulationFps);
  }
  bounds(): Bounds {
    const offset = new this.runtime.Vector2(),
      size = new this.runtime.Vector2();
    this.skeleton.getBounds(offset, size, []);
    if (
      ![offset.x, offset.y, size.x, size.y].every(Number.isFinite) ||
      size.x <= 0 ||
      size.y <= 0
    )
      return {
        x: 0,
        y: 0,
        width: Math.max(1, this.data.width || 200),
        height: Math.max(1, this.data.height || 400),
      };
    return { x: offset.x, y: offset.y, width: size.x, height: size.y };
  }
  draw(
    width: number,
    height: number,
    camera: Bounds,
    background: string | null,
  ): void {
    if (this.disposed || this.gl.isContextLost())
      throw new Error("WebGL context unavailable.");
    const limit = Math.min(
      this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) as number,
      this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number,
    );
    if (width > limit || height > limit)
      throw new Error(`Render target exceeds GPU limit ${limit}.`);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const cam = this.scene.camera;
    cam.position.x = camera.x + camera.width / 2;
    cam.position.y = camera.y + camera.height / 2;
    cam.up.y = 1;
    cam.direction.z = -1;
    cam.near = 0;
    cam.far = 2;
    cam.viewportWidth = camera.width;
    cam.viewportHeight = camera.height;
    cam.update();
    const color = background
      ? [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16) / 255)
      : [0, 0, 0];
    this.gl.viewport(0, 0, width, height);
    this.gl.clearColor(color[0]!, color[1]!, color[2]!, background ? 1 : 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (
      this.scene.skeletonRenderer &&
      "pmaAdditiveBatching" in this.scene.skeletonRenderer
    )
      this.scene.skeletonRenderer.pmaAdditiveBatching = false;
    this.scene.begin();
    if (this.runtime.apiVersion === "4.3")
      this.scene.drawSkeleton(this.skeleton);
    else this.scene.drawSkeleton(this.skeleton, this.pma);
    this.scene.end();
  }
  rgba(width: number, height: number): Uint8Array {
    // Canvas compositor performs the framebuffer→straight-alpha conversion. 2D readback is top-down.
    // This avoids blindly unpremultiplying additive/multiply framebuffer values. Fidelity remains fixture-gated.
    const output = this.readbackCanvas;
    if (output.width !== width) output.width = width;
    if (output.height !== height) output.height = height;
    const ctx = output.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D readback unavailable.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.canvas, 0, 0, width, height);
    const bytes = new Uint8Array(
      ctx.getImageData(0, 0, width, height).data.buffer,
    );
    return bytes;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Atlas.dispose owns page textures; explicit texture set is only the partial-construction cleanup path.
    this.state.clearTracks();
    this.atlas.dispose();
    this.textures.clear();
    this.scene.dispose();
    this.context.dispose();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.width = this.canvas.height = 1;
    this.readbackCanvas.width = this.readbackCanvas.height = 1;
  }
}
export function union(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
export function cameraFor(bounds: Bounds, s: ExportSettings): Bounds {
  const base =
    s.framing === "custom" || s.framing === "fixed" ? s.camera : bounds;
  let width = (base.width + 2 * s.padding) / s.scale,
    height = (base.height + 2 * s.padding) / s.scale;
  const aspect = s.width / s.height;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  return {
    x: base.x + base.width / 2 - width / 2 + s.offsetX,
    y: base.y + base.height / 2 - height / 2 + s.offsetY,
    width,
    height,
  };
}
