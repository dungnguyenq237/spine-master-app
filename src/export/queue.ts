import type {
  Asset,
  Bounds,
  ExportSettings,
  JobStatus,
} from "../core/contracts";
import { loadAsset } from "../core/assets";
import { loadRuntime } from "../runtime/registry";
import { SpineRenderer, cameraFor, union } from "../render/renderer";
import { effectiveFps, frameCount, sample, validateSettings } from "./schedule";
import * as native from "../native/bridge";
import { Metrics } from "./metrics";
export interface Job {
  id: string;
  nativeId: string | null;
  asset: Asset;
  settings: Readonly<ExportSettings>;
  destination: string;
  status: JobStatus;
  frame: number;
  total: number;
  error: string;
  output: string;
  started: number;
  ended: number;
  cancelled: boolean;
  metrics: ReturnType<Metrics["snapshot"]>;
}
const terminal = new Set<JobStatus>(["completed", "failed", "cancelled"]);
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export class ExportQueue extends EventTarget {
  readonly jobs: Job[] = [];
  busy = false;
  add(asset: Asset, settings: ExportSettings, destination: string): void {
    const validated = validateSettings(settings);
    this.jobs.push({
      id: crypto.randomUUID(),
      nativeId: null,
      asset,
      settings: validated,
      destination,
      status: "queued",
      frame: 0,
      total: frameCount(settings),
      error: "",
      output: "",
      started: 0,
      ended: 0,
      cancelled: false,
      metrics: {},
    });
    this.changed();
    void this.pump();
  }
  async cancel(job: Job): Promise<void> {
    if (terminal.has(job.status)) return;
    job.cancelled = true;
    if (job.nativeId) {
      try {
        await native.cancelExport(job.nativeId);
      } catch (error) {
        job.cancelled = false;
        this.changed();
        throw error;
      }
    }
    if (job.status === "queued") job.status = "cancelled";
    this.changed();
  }
  retry(job: Job): void {
    if (job.status === "failed" || job.status === "cancelled")
      this.add(job.asset, job.settings, job.destination);
  }
  changed(): void {
    this.dispatchEvent(new Event("change"));
  }
  private check(job: Job): void {
    if (job.cancelled) throw new DOMException("Export cancelled", "AbortError");
  }
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    try {
      for (const job of this.jobs)
        if (job.status === "queued") await this.run(job);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async run(job: Job): Promise<void> {
    let renderer: SpineRenderer | null = null;
    let source: Awaited<ReturnType<typeof loadAsset>> | null = null;
    const metrics = new Metrics();
    job.started = Date.now();
    job.status = "preparing";
    this.changed();
    try {
      source = await loadAsset(job.asset);
      this.check(job);
      const runtime = await loadRuntime(source.key);
      renderer = new SpineRenderer(
        document.createElement("canvas"),
        runtime,
        source,
      );
      const s = job.settings;
      let bounds: Bounds | null = null;
      let previousCycle = -1;
      const pose = async (i: number) => {
        const point = sample(s, i);
        if (point.cycle !== previousCycle) {
          renderer!.reset(s.animation, s.skin);
          previousCycle = point.cycle;
        }
        await renderer!.advanceToAsync(point.time, s.simulationFps, () =>
          this.check(job),
        );
      };
      if (s.framing === "auto" || s.framing === "tight") {
        for (let i = 0; i < job.total; i++) {
          this.check(job);
          await pose(i);
          bounds = union(bounds, renderer.bounds());
          if (i % 8 === 0) {
            job.frame = i;
            this.changed();
            await yieldTask();
          }
        }
      }
      const camera = cameraFor(bounds ?? renderer.bounds(), s);
      previousCycle = -1;
      this.check(job);
      job.nativeId = await native.startExport({
        format: s.format,
        width: s.width,
        height: s.height,
        fps: effectiveFps(s),
        frames: job.total,
        quality: s.quality,
        transparent: s.background === null,
        columns: s.columns,
        sheetPadding: s.sheetPadding,
        dither: s.dither,
        paletteColors: s.paletteColors,
        alphaThreshold: s.alphaThreshold,
        gifRepeat: s.gifRepeat,
        name: `${job.asset.name}_${s.animation || "setup"}`,
        destination: job.destination,
      });
      this.check(job);
      job.status = "rendering";
      job.frame = 0;
      for (let i = 0; i < job.total; i++) {
        this.check(job);
        await metrics.measure("render", async () => {
          await pose(i);
          renderer!.draw(
            s.width * s.supersampling,
            s.height * s.supersampling,
            camera,
            s.background,
          );
        });
        const rgba = await metrics.measure("readback", () =>
          renderer!.rgba(s.width, s.height),
        );
        await metrics.measure("transport", () =>
          native.sendFrame(job.nativeId!, i, rgba),
        );
        job.frame = i + 1;
        this.changed();
        await yieldTask();
      }
      this.check(job);
      job.status = "encoding";
      this.changed();
      const result = await metrics.measure("encodeAndFinalize", () =>
        native.finishExport(job.nativeId!),
      );
      job.output = result.output;
      job.status = "completed";
    } catch (error) {
      if (job.nativeId)
        await native.cancelExport(job.nativeId).catch(() => undefined);
      job.status = job.cancelled ? "cancelled" : "failed";
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      renderer?.dispose();
      source?.dispose();
      job.metrics = metrics.snapshot();
      job.ended = Date.now();
      this.changed();
    }
  }
}
