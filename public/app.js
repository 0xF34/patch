import { inspectMp4, moveMoovToFront } from "./mp4.js";

const fileInput = document.querySelector("#file");
const chooseButton = document.querySelector("#choose");
const drop = document.querySelector("#drop");
const info = document.querySelector("#info");
const actions = document.querySelector("#actions");
const patchButton = document.querySelector("#patch");
const clearButton = document.querySelector("#clear");
const download = document.querySelector("#download");
const status = document.querySelector("#status");

let selectedFile = null;
let selectedBytes = null;
let outputUrl = null;

const $ = (id) => document.querySelector(id);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 0; i < units.length - 1 && value >= 1024; i++) {
    value /= 1024;
    unit = units[i + 1];
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

function formatFps(fps) {
  return Number.isFinite(fps) ? `${fps.toFixed(3)} fps` : "—";
}

function reset() {
  selectedFile = null;
  selectedBytes = null;
  fileInput.value = "";
  info.classList.add("hidden");
  actions.classList.add("hidden");
  download.classList.add("hidden");
  download.removeAttribute("href");
  status.textContent = "";

  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }
}

async function loadFile(file) {
  if (!file) return;

  if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
    status.textContent = "Please choose an MP4 file.";
    return;
  }

  status.textContent = "Reading MP4 metadata locally…";

  try {
    selectedFile = file;
    selectedBytes = new Uint8Array(await file.arrayBuffer());
    const meta = inspectMp4(selectedBytes);

    $("name").textContent = file.name;
    $("size").textContent = formatBytes(file.size);
    $("resolution").textContent = meta.width && meta.height ? `${meta.width} × ${meta.height}` : "—";
    $("duration").textContent = formatDuration(meta.duration);
    $("fps").textContent = formatFps(meta.fps);
    $("codec").textContent = meta.codec ?? "—";
    $("container").textContent = `${meta.container} · moov @ ${meta.moovAt.toLocaleString()}`;

    info.classList.remove("hidden");
    actions.classList.remove("hidden");
    status.textContent = "Ready. FPS and sample timing are left untouched.";
  } catch (error) {
    reset();
    status.textContent = error instanceof Error ? error.message : "Unable to read this MP4.";
  }
}

async function patch() {
  if (!selectedFile || !selectedBytes) return;

  patchButton.disabled = true;
  status.textContent = "Checking container…";

  try {
    const result = moveMoovToFront(selectedBytes);

    // Safe mode intentionally returns the original bytes unless all required
    // offset rewriting can be proven safe. This prevents broken MP4 output.
    const blob = new Blob([result.bytes], { type: "video/mp4" });

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);

    download.href = outputUrl;
    download.download = selectedFile.name.replace(/\.mp4$/i, "") + "_patched.mp4";
    download.classList.remove("hidden");

    status.textContent = result.changed
      ? "Patch complete."
      : "Safe container mode: the original media samples and FPS were preserved exactly.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Patch failed.";
  } finally {
    patchButton.disabled = false;
  }
}

chooseButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => loadFile(fileInput.files?.[0]));

for (const event of ["dragenter", "dragover"]) {
  drop.addEventListener(event, (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
}

for (const event of ["dragleave", "drop"]) {
  drop.addEventListener(event, (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
  });
}

drop.addEventListener("drop", (e) => {
  loadFile(e.dataTransfer.files?.[0]);
});

patchButton.addEventListener("click", patch);
clearButton.addEventListener("click", reset);
