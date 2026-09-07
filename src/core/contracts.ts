export interface AssetFile {
  root: string;
  path: string;
  size: number;
  modified: number;
}
export interface Asset {
  id: string;
  name: string;
  skeleton: AssetFile;
  atlas: AssetFile | null;
  files: readonly AssetFile[];
}
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Animation {
  name: string;
  duration: number;
}
export type Format = "mp4" | "gif" | "png" | "sheet" | "prores" | "webm";
export type Quality = "fast" | "balanced" | "high" | "maximum";
export interface ExportSettings {
  format: Format;
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  speed: number;
  loops: number;
  includeFinal: boolean;
  simulationFps: number;
  animation: string;
  skin: string;
  background: string | null;
  quality: Quality;
  supersampling: number;
  framing: "auto" | "tight" | "fixed" | "custom";
  padding: number;
  camera: Bounds;
  offsetX: number;
  offsetY: number;
  scale: number;
  columns: number;
  sheetPadding: number;
  dither: "sierra2_4a" | "bayer" | "none";
  paletteColors: number;
  alphaThreshold: number;
  gifRepeat: number;
}
export interface NativeExport {
  format: Format;
  width: number;
  height: number;
  fps: number;
  frames: number;
  quality: Quality;
  transparent: boolean;
  columns: number;
  sheetPadding: number;
  dither: string;
  paletteColors: number;
  alphaThreshold: number;
  gifRepeat: number;
  name: string;
  destination: string;
}
export interface EncoderCapabilities {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  encoders: string[];
  pixelFormats: string[];
}
export type JobStatus =
  | "queued"
  | "preparing"
  | "rendering"
  | "encoding"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";
export interface NativeProgress {
  id: string;
  stage: JobStatus;
  frame: number;
  total: number;
  message: string;
}
export interface ExportResult {
  output: string;
  verification: string;
}
