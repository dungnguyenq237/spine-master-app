import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AssetFile,
  EncoderCapabilities,
  ExportResult,
  NativeExport,
  NativeProgress,
} from "../core/contracts";
export const pickAssets = () => invoke<AssetFile[]>("pick_assets");
export const droppedAssets = (paths: string[]) =>
  invoke<AssetFile[]>("import_dropped", { paths });
export const readAsset = (file: AssetFile) =>
  invoke<ArrayBuffer>("read_asset", { root: file.root, path: file.path });
export const pickDestination = () => invoke<string | null>("pick_destination");
export const capabilities = () =>
  invoke<EncoderCapabilities>("encoder_capabilities");
export const configureEncoder = () =>
  invoke<EncoderCapabilities | null>("configure_encoder");
export const startExport = (settings: NativeExport) =>
  invoke<string>("start_export", { settings });
export const sendFrame = (id: string, index: number, pixels: Uint8Array) =>
  invoke<void>("write_frame", pixels, {
    headers: { "x-job-id": id, "x-frame-index": String(index) },
  });
export const finishExport = (id: string) =>
  invoke<ExportResult>("finish_export", { id });
export const cancelExport = (id: string) =>
  invoke<void>("cancel_export", { id });
export const openOutput = (id: string) => invoke<void>("open_output", { id });
export const onProgress = (callback: (progress: NativeProgress) => void) =>
  listen<NativeProgress>("export-progress", (e) => callback(e.payload));
export const cacheGet = (key: string) =>
  invoke<ArrayBuffer>("cache_get", { key });
export const cachePut = (key: string, bytes: Uint8Array) =>
  invoke<void>("cache_put", bytes, { headers: { "x-cache-key": key } });
