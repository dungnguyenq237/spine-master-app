import "./ui/studio.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "@tauri-apps/api/core";
import { layout } from "./ui/layout";
import { required, element, message } from "./ui/dom";
import { Gallery } from "./ui/gallery";
import { Preview } from "./ui/preview";
import { ExportQueue } from "./export/queue";
import { effectiveFps, validateSettings } from "./export/schedule";
import { readSettings } from "./ui/export-form";
import { groupAssets } from "./core/assets";
import type { Asset, AssetFile, Animation } from "./core/contracts";
import * as native from "./native/bridge";
required("#app").innerHTML = layout;
const queue = new ExportQueue();
let files: AssetFile[] = [];
let selected: Asset | null = null;
let animations: Animation[] = [];
let destination = "";
let sourceMax = 0;
const status = (text: string) => {
  required("#status").textContent = text;
};
const report = (error: unknown) => status(message(error));
const preview = new Preview((asset, renderer, source) => {
  selected = asset;
  animations = renderer.data.animations;
  sourceMax = source.sourceMax;
  required<HTMLInputElement>("#start").value = "0";
  required<HTMLInputElement>("#end").value = String(preview.duration);
  const bounds = renderer.bounds();
  for (const [id, value] of Object.entries({
    cameraX: bounds.x,
    cameraY: bounds.y,
    cameraWidth: bounds.width,
    cameraHeight: bounds.height,
  }))
    required<HTMLInputElement>(`#${id}`).value = String(value);
  const batch = required("#batchAnimations");
  batch.replaceChildren();
  for (const animation of animations) {
    const label = element("label"),
      input = element("input");
    input.type = "checkbox";
    input.value = animation.name;
    label.append(input, document.createTextNode(animation.name));
    batch.append(label);
  }
  hint();
});
const gallery = new Gallery(required("#gallery"), (asset) => {
  selected = null;
  void preview.open(asset);
});
gallery.setAssets([]);
function ingest(incoming: AssetFile[]): void {
  const merged = new Map(files.map((f) => [`${f.root}/${f.path}`, f]));
  for (const file of incoming) merged.set(`${file.root}/${file.path}`, file);
  files = [...merged.values()];
  const assets = groupAssets(files);
  gallery.setAssets(assets);
  status(
    `${assets.length} skeleton files indexed. Textures load only for visible previews.`,
  );
}
required("#pick").onclick = () => {
  void native.pickAssets().then(ingest).catch(report);
};
required("#clear").onclick = () => {
  files = [];
  gallery.setAssets([]);
  status("Asset library cleared. Queued jobs keep their source references.");
};
required<HTMLInputElement>("#search").oninput = (e) =>
  gallery.filter((e.currentTarget as HTMLInputElement).value);
required<HTMLSelectElement>("#cardZoom").onchange = (e) =>
  gallery.setZoom(Number((e.currentTarget as HTMLSelectElement).value));
required("#encoder").onclick = () => {
  void native
    .configureEncoder()
    .then((c) => {
      if (c)
        status(
          `${c.version}. Available export encoders: ${c.encoders.filter((v) => ["libx264", "libvpx-vp9", "prores_ks", "ffv1", "h264_nvenc", "h264_qsv", "h264_amf"].includes(v)).join(", ")}. Hardware paths are not enabled without benchmarks.`,
        );
    })
    .catch(report);
};
required("#destination").onclick = () => {
  void native
    .pickDestination()
    .then((id) => {
      if (id) {
        destination = id;
        required("#destinationLabel").textContent = "Output folder selected";
      }
    })
    .catch(report);
};
const format = required<HTMLSelectElement>("#format"),
  transparent = required<HTMLInputElement>("#transparent");
function compatibility(): void {
  transparent.disabled = format.value === "mp4";
  if (transparent.disabled) transparent.checked = false;
  hint();
}
function hint(): void {
  const s = readSettings(preview.animation, preview.skin),
    notes: string[] = [];
  if (s.format === "gif")
    notes.push(
      `GIF timing: ${effectiveFps(s).toFixed(2)} effective FPS; ${s.paletteColors} colors and binary transparency.`,
    );
  if (s.format === "mp4")
    notes.push("H.264 uses an opaque background and even dimensions.");
  if (s.format === "prores" || s.format === "webm")
    notes.push(
      "Alpha output requires validation in your target editor/player.",
    );
  if (Math.max(s.width, s.height) > sourceMax && sourceMax > 0)
    notes.push(
      "Output exceeds the largest source texture dimension; upscaling cannot restore texture detail.",
    );
  if (s.supersampling > 1)
    notes.push(
      "Supersampling increases GPU memory and uses browser high-quality downsampling.",
    );
  required("#exportHint").textContent = notes.join(" ");
}
format.onchange = compatibility;
required("#exportForm").addEventListener("input", hint);
let ratio = 1;
const width = required<HTMLInputElement>("#width"),
  height = required<HTMLInputElement>("#height"),
  lock = required<HTMLInputElement>("#aspectLock");
lock.onchange = () => {
  ratio = Number(width.value) / Number(height.value);
};
width.addEventListener("change", () => {
  if (lock.checked)
    height.value = String(Math.round(Number(width.value) / ratio));
  hint();
});
height.addEventListener("change", () => {
  if (lock.checked)
    width.value = String(Math.round(Number(height.value) * ratio));
  hint();
});
required<HTMLSelectElement>("#framing").onchange = (e) => {
  if ((e.currentTarget as HTMLSelectElement).value === "tight")
    required<HTMLInputElement>("#padding").value = "0";
};
required<HTMLFormElement>("#exportForm").onsubmit = (e) => {
  e.preventDefault();
  required("#exportError").textContent = "";
  try {
    if (!selected) throw new Error("Wait for a valid asset to load.");
    if (!destination) throw new Error("Choose an output folder.");
    const settings = readSettings(preview.animation, preview.skin);
    if (settings.end > preview.duration + 1e-6)
      throw new Error("Trim end exceeds animation duration.");
    const checked = [
      ...required("#batchAnimations").querySelectorAll<HTMLInputElement>(
        "input:checked",
      ),
    ];
    const batch = checked.map((input) => {
      const animation = animations.find((a) => a.name === input.value);
      if (!animation) throw new Error("Batch animation unavailable.");
      return {
        ...settings,
        animation: animation.name,
        start: 0,
        end: Math.max(0.001, animation.duration),
      };
    });
    const requests = batch.length ? batch : [settings];
    requests.forEach(validateSettings);
    for (const request of requests) queue.add(selected, request, destination);
    required("#exportError").textContent =
      `Added ${requests.length} job(s). You can close the workspace and follow progress below.`;
  } catch (error) {
    required("#exportError").textContent = message(error);
  }
};
let paused = false;
queue.addEventListener("change", () => {
  if (paused !== queue.busy) {
    paused = queue.busy;
    gallery.pause(paused);
  }
  const root = required("#queue");
  root.replaceChildren();
  let done = 0;
  for (const job of queue.jobs) {
    const card = element("article", "job"),
      title = element(
        "strong",
        "",
        `${job.asset.name} / ${job.settings.animation} · ${job.settings.format.toUpperCase()} · ${job.status}`,
      ),
      progress = element("progress");
    progress.max = job.total;
    progress.value = job.frame;
    const elapsed = job.started
      ? ((job.ended || Date.now()) - job.started) / 1000
      : 0;
    const info = element(
      "small",
      "",
      `${job.frame}/${job.total} frames · ${elapsed.toFixed(1)} s${job.status === "rendering" && job.frame > 10 ? ` · ~${((elapsed / job.frame) * (job.total - job.frame)).toFixed(0)} s rendering remaining` : ""}`,
    );
    const actions = element("div", "job-actions");
    if (
      ["queued", "preparing", "rendering", "encoding", "finalizing"].includes(
        job.status,
      )
    ) {
      const cancel = element("button", "btn", "Cancel");
      cancel.onclick = () => void queue.cancel(job).catch(report);
      actions.append(cancel);
    }
    if (job.status === "failed" || job.status === "cancelled") {
      const retry = element("button", "btn", "Retry");
      retry.onclick = () => queue.retry(job);
      actions.append(retry);
    }
    if (job.status === "completed" && job.nativeId) {
      const reveal = element("button", "btn", "Open output folder");
      reveal.onclick = () =>
        void native.openOutput(job.nativeId!).catch(report);
      actions.append(reveal);
    }
    card.append(title, progress, info, actions);
    if (job.error) card.append(element("p", "", job.error));
    if (job.output) card.append(element("p", "", job.output));
    if (Object.keys(job.metrics).length) {
      const details = element("details"),
        summary = element("summary", "", "Stage timings"),
        pre = element("pre", "", JSON.stringify(job.metrics, null, 2));
      details.append(summary, pre);
      card.append(details);
    }
    root.append(card);
    done += ["completed", "failed", "cancelled"].includes(job.status)
      ? 1
      : (job.frame / job.total) * 0.8;
  }
  required<HTMLProgressElement>("#overallProgress").value = queue.jobs.length
    ? done / queue.jobs.length
    : 0;
  required("#queueSummary").textContent =
    `${queue.jobs.filter((j) => j.status === "completed").length} completed / ${queue.jobs.length} jobs · ${queue.busy ? "Exporting" : "Idle"}`;
});
if (isTauri()) {
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      if (event.payload.type === "drop")
        void native
          .droppedAssets(event.payload.paths)
          .then(ingest)
          .catch(report);
    })
    .catch(report);
  void native
    .onProgress((p) => {
      const job = queue.jobs.find((j) => j.nativeId === p.id);
      if (
        job &&
        job.status !== "rendering" &&
        ["encoding", "finalizing"].includes(p.stage)
      ) {
        job.status = p.stage;
        queue.changed();
      }
    })
    .catch(report);
} else {
  status(
    "Open with npm run desktop:dev for native filesystem and exports. This browser view is UI-only.",
  );
  required<HTMLButtonElement>("#pick").disabled = true;
  required<HTMLButtonElement>("#encoder").disabled = true;
}
compatibility();
