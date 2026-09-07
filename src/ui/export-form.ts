import type { ExportSettings, Format, Quality } from "../core/contracts";
import { required } from "./dom";
export const numberValue = (id: string): number =>
  Number(required<HTMLInputElement>(`#${id}`).value);
export function readSettings(animation: string, skin: string): ExportSettings {
  return {
    format: required<HTMLSelectElement>("#format").value as Format,
    width: numberValue("width"),
    height: numberValue("height"),
    fps: numberValue("fps"),
    start: numberValue("start"),
    end: numberValue("end"),
    speed: numberValue("speed"),
    loops: numberValue("loops"),
    includeFinal: required<HTMLInputElement>("#includeFinal").checked,
    simulationFps: numberValue("simulationFps"),
    animation,
    skin,
    background: required<HTMLInputElement>("#transparent").checked
      ? null
      : required<HTMLInputElement>("#background").value,
    quality: required<HTMLSelectElement>("#quality").value as Quality,
    supersampling: numberValue("supersampling"),
    framing: required<HTMLSelectElement>("#framing")
      .value as ExportSettings["framing"],
    padding: numberValue("padding"),
    camera: {
      x: numberValue("cameraX"),
      y: numberValue("cameraY"),
      width: numberValue("cameraWidth"),
      height: numberValue("cameraHeight"),
    },
    offsetX: numberValue("offsetX"),
    offsetY: numberValue("offsetY"),
    scale: numberValue("scale"),
    columns: numberValue("columns"),
    sheetPadding: numberValue("sheetPadding"),
    dither: required<HTMLSelectElement>("#dither")
      .value as ExportSettings["dither"],
    paletteColors: numberValue("paletteColors"),
    alphaThreshold: numberValue("alphaThreshold"),
    gifRepeat: numberValue("gifRepeat"),
  };
}
