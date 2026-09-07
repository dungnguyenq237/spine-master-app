// Structural boundary for the original versioned official WebGL bundles. No runtime objects escape rendering.
export interface Vector {
  x: number;
  y: number;
}
export interface Disposable {
  dispose(): void;
}
export interface SkeletonData {
  animations: { name: string; duration: number }[];
  skins: { name: string }[];
  width: number;
  height: number;
}
export interface Skeleton {
  setToSetupPose?(): void;
  setupPose?(): void;
  setSkinByName?(name: string): void;
  setSkin?(name: string): void;
  setSlotsToSetupPose?(): void;
  setupPoseSlots?(): void;
  update?(delta: number): void;
  updateWorldTransform(physics?: number): void;
  getBounds(offset: Vector, size: Vector, temp: number[]): void;
}
export interface AnimationState {
  setAnimation(track: number, name: string, loop: boolean): unknown;
  update(delta: number): void;
  apply(skeleton: Skeleton): unknown;
  clearTracks(): void;
}
export interface AtlasPage {
  name: string;
  pma?: boolean;
  texture?: Disposable;
  setTexture?(texture: Disposable): void;
}
export interface Atlas extends Disposable {
  pages: AtlasPage[];
}
export interface ManagedContext extends Disposable {
  gl: WebGLRenderingContext;
}
export interface SceneRenderer extends Disposable {
  skeletonRenderer?: { pmaAdditiveBatching?: boolean };
  camera: {
    position: Vector;
    up: { y: number };
    direction: { z: number };
    near: number;
    far: number;
    viewportWidth: number;
    viewportHeight: number;
    update(): void;
  };
  begin(): void;
  drawSkeleton(skeleton: Skeleton, pma?: boolean): void;
  end(): void;
}
export interface Runtime {
  apiVersion?: string;
  Vector2: new () => Vector;
  Physics?: { update: number; reset: number };
  TextureAtlas: new (
    text: string,
    loader?: (page: string) => Disposable,
  ) => Atlas;
  AtlasAttachmentLoader: new (atlas: Atlas) => object;
  SkeletonJson: new (loader: object) => {
    readSkeletonData(data: unknown): SkeletonData;
  };
  SkeletonBinary: new (loader: object) => {
    readSkeletonData(data: Uint8Array): SkeletonData;
  };
  Skeleton: new (data: SkeletonData) => Skeleton;
  AnimationStateData: new (data: SkeletonData) => { defaultMix: number };
  AnimationState: new (data: object) => AnimationState;
  webgl: {
    ManagedWebGLRenderingContext: new (
      canvas: HTMLCanvasElement,
      options: WebGLContextAttributes,
    ) => ManagedContext;
    SceneRenderer: new (
      canvas: HTMLCanvasElement,
      context: ManagedContext,
    ) => SceneRenderer;
    GLTexture: {
      new (
        context: ManagedContext,
        image: HTMLImageElement,
        pmaOrMipmaps?: boolean,
      ): Disposable;
      DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL?: boolean;
    };
  };
}
