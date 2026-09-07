import type { ExportSettings } from "../core/contracts";
export function validateSettings(s: ExportSettings): Readonly<ExportSettings> {
  const integer = (n: number, min: number, max: number, name: string) => {
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  };
  integer(s.width, 2, 8192, "Width");
  integer(s.height, 2, 8192, "Height");
  integer(s.fps, 1, 120, "FPS");
  integer(s.simulationFps, 30, 480, "Simulation FPS");
  integer(s.loops, 1, 100, "Loops");
  integer(s.columns, 1, 32, "Columns");
  integer(s.sheetPadding, 0, 64, "Sheet padding");
  integer(s.paletteColors, 4, 256, "Palette colors");
  integer(s.alphaThreshold, 0, 255, "Alpha threshold");
  integer(s.gifRepeat, -1, 65535, "GIF repeat");
  if (
    !["mp4", "gif", "png", "sheet", "prores", "webm"].includes(s.format) ||
    !["fast", "balanced", "high", "maximum"].includes(s.quality)
  )
    throw new Error("Unknown format or preset.");
  if (![1, 2, 4].includes(s.supersampling))
    throw new Error("Supersampling must be 1, 2 or 4.");
  if (
    !Number.isFinite(s.start) ||
    !Number.isFinite(s.end) ||
    s.start < 0 ||
    s.end <= s.start ||
    s.end > 86400
  )
    throw new Error("Invalid animation range.");
  if (!Number.isFinite(s.speed) || s.speed < 0.01 || s.speed > 10)
    throw new Error("Speed must be 0.01–10.");
  if (s.background !== null && !/^#[a-f\d]{6}$/i.test(s.background))
    throw new Error("Background must be a hex RGB color.");
  if (s.format === "mp4" && s.background === null)
    throw new Error("H.264 MP4 requires an opaque background.");
  if (s.format === "mp4" && (s.width % 2 || s.height % 2))
    throw new Error("Compatible H.264 requires even dimensions.");
  if (s.width * s.height > 32 * 1024 * 1024)
    throw new Error("Output exceeds 32 megapixels.");
  if (s.format === "webm" && (s.width % 2 || s.height % 2))
    throw new Error("VP9 4:2:0 requires even dimensions.");
  if (s.width * s.height * s.supersampling ** 2 > 64 * 1024 * 1024)
    throw new Error("Render target exceeds 64 megapixels.");
  for (const v of [
    s.padding,
    s.offsetX,
    s.offsetY,
    s.scale,
    ...Object.values(s.camera),
  ])
    if (!Number.isFinite(v)) throw new Error("Framing values must be finite.");
  if (
    s.padding < 0 ||
    s.padding > 10000 ||
    s.scale <= 0 ||
    s.scale > 100 ||
    s.camera.width <= 0 ||
    s.camera.height <= 0
  )
    throw new Error("Invalid camera/padding/scale.");
  if (frameCount(s) > 1_000_000)
    throw new Error("Export exceeds one million frames.");
  return Object.freeze({ ...s, camera: Object.freeze({ ...s.camera }) });
}
// GIF uses a constant representable centisecond delay; the UI reports the effective rate.
export const effectiveFps = (s: ExportSettings) =>
  s.format === "gif" ? 100 / Math.max(1, Math.round(100 / s.fps)) : s.fps;
export const outputDuration = (s: ExportSettings) =>
  ((s.end - s.start) * s.loops) / s.speed;
export const frameCount = (s: ExportSettings) =>
  Math.max(1, Math.ceil(outputDuration(s) * effectiveFps(s) - 1e-9)) +
  Number(s.includeFinal);
export function sample(
  s: ExportSettings,
  index: number,
): { cycle: number; time: number } {
  const length = s.end - s.start;
  const elapsed = Math.min(
    (index / effectiveFps(s)) * s.speed,
    length * s.loops,
  );
  if (elapsed >= length * s.loops) return { cycle: s.loops - 1, time: s.end };
  return {
    cycle: Math.floor(elapsed / length),
    time: s.start + (elapsed % length),
  };
}
