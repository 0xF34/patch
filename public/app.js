import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';

const $ = (id) => document.getElementById(id);
const fileInput = $('file');
const drop = $('drop');
const info = $('info');
const previewCard = $('previewCard');
const preview = $('preview');
const controls = $('controls');
const watermarkControls = $('watermarkControls');
const audioControls = $('audioControls');
const actions = $('actions');
const processButton = $('process');
const clearButton = $('clear');
const download = $('download');
const status = $('status');
const progressWrap = $('progressWrap');
const progressBar = $('progress');
const progressTitle = $('progressTitle');
const progressPercent = $('progressPercent');

const ffmpeg = new FFmpeg();
let ffmpegReady = false;
let selectedFile = null;
let outputUrl = null;
let inputName = '';
let sourceUrl = null;
let sourceIsVideo = false;
let sourceIsAudio = false;
let processing = false;

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function show(node) {
  node?.classList.remove('hidden');
}

function hide(node) {
  node?.classList.add('hidden');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 0; i < units.length - 1 && value >= 1024; i++) {
    value /= 1024;
    unit = units[i + 1];
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function setProgress(percent, title) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  show(progressWrap);
  progressBar.style.width = `${value}%`;
  progressPercent.textContent = `${value}%`;
  progressTitle.textContent = title;
}

function setStep(step) {
  ['step1', 'step2', 'step3'].forEach((id, index) => {
    const node = $(id);
    node?.classList.toggle('active', index + 1 === step);
    node?.classList.toggle('done', index + 1 < step);
  });
}

function safeInputName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extensionFor(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return ext;
  if (file.type.startsWith('audio/')) return 'audio';
  return 'mp4';
}

function reset() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  sourceUrl = null;
  outputUrl = null;
  selectedFile = null;
  inputName = '';
  sourceIsVideo = false;
  sourceIsAudio = false;
  fileInput.value = '';
  preview.removeAttribute('src');
  preview.load();
  hide(info); hide(previewCard); hide(controls); hide(watermarkControls); hide(audioControls); hide(actions); hide(progressWrap); hide(download);
  setText('status', 'Waiting for a file.');
  processButton.disabled = false;
}

async function readMediaMetadata(file) {
  const url = URL.createObjectURL(file);
  const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
  media.preload = 'metadata';
  media.src = url;
  media.playsInline = true;

  return new Promise((resolve, reject) => {
    media.onloadedmetadata = () => {
      const result = {
        duration: media.duration,
        width: media.videoWidth || 0,
        height: media.videoHeight || 0
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The browser could not read this media file.'));
    };
  });
}

async function loadFile(file) {
  if (!file || processing) return;
  reset();
  selectedFile = file;
  inputName = safeInputName(file.name);
  sourceIsVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(file.name);
  sourceIsAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name);

  try {
    setProgress(3, 'Checking file');
    setStep(1);
    setText('status', 'Reading media metadata…');
    const meta = await readMediaMetadata(file);

    setProgress(10, 'File ready');
    setText('name', file.name);
    setText('size', formatBytes(file.size));
    setText('duration', formatDuration(meta.duration));
    setText('type', sourceIsVideo ? 'VIDEO' : 'AUDIO');
    setText('video', sourceIsVideo ? `${meta.width} × ${meta.height}` : 'None');
    setText('audio', sourceIsAudio || sourceIsVideo ? 'Available' : 'None');

    sourceUrl = URL.createObjectURL(file);
    if (sourceIsVideo) {
      preview.src = sourceUrl;
      show(previewCard);
      show(controls);
      show(watermarkControls);
      hide(audioControls);
    } else {
      hide(previewCard);
      hide(controls);
      hide(watermarkControls);
      show(audioControls);
    }

    show(info);
    show(actions);
    setText('status', 'Ready. Choose your output settings, then process.');
  } catch (error) {
    reset();
    setText('status', error instanceof Error ? error.message : 'Could not read this file.');
  }
}

async function ensureFFmpeg() {
  if (ffmpegReady) return;
  setProgress(8, 'Loading encoder');
  setStep(1);
  setText('status', 'Loading FFmpeg engine. The first run is large and can take a moment…');

  ffmpeg.on('progress', ({ progress }) => {
    const p = Number.isFinite(progress) ? progress : 0;
    setStep(2);
    setProgress(10 + p * 82, 'Encoding');
    setText('status', `Encoding… ${Math.round(p * 100)}%`);
  });

  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
  const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
  const workerURL = await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript');
  await ffmpeg.load({ coreURL, wasmURL, workerURL });
  ffmpegReady = true;
}

function buildVideoFilter(width, height) {
  const filters = [];
  const resolution = $('resolution')?.value || 'source';
  const fps = $('fps')?.value || 'source';
  const brightness = Number($('brightness')?.value || 0);
  const contrast = Number($('contrast')?.value || 1);
  const rotation = $('rotation')?.value || '0';
  const mirror = $('mirror')?.value || 'none';
  const preset = $('watermarkPreset')?.value || 'none';
  const size = Number($('watermarkSize')?.value || 12) / 100;

  if (resolution !== 'source') {
    const [rw, rh] = resolution.split(':').map(Number);
    const ratio = width / Math.max(height, 1);
    const targetRatio = rw / rh;
    const fitW = ratio >= targetRatio ? rw : -2;
    const fitH = ratio >= targetRatio ? -2 : rh;
    filters.push(`scale=${fitW}:${fitH}:force_original_aspect_ratio=decrease`);
  }

  if (fps !== 'source') filters.push(`fps=${fps}`);
  if (brightness !== 0 || contrast !== 1) filters.push(`eq=brightness=${brightness}:contrast=${contrast}`);
  if (mirror === 'horizontal') filters.push('hflip');
  if (mirror === 'vertical') filters.push('vflip');
  if (rotation === '90') filters.push('transpose=1');
  if (rotation === '180') filters.push('transpose=1,transpose=1');
  if (rotation === '270') filters.push('transpose=2');

  if (preset !== 'none') {
    const w = Math.max(16, Math.round(width * size));
    const h = Math.max(16, Math.round(height * size * 0.65));
    const margin = Math.max(4, Math.round(Math.min(width, height) * 0.02));
    let x = margin;
    let y = margin;
    if (preset.includes('right')) x = width - w - margin;
    if (preset.includes('bottom')) y = height - h - margin;
    if (preset === 'center') {
      x = Math.round((width - w) / 2);
      y = Math.round((height - h) / 2);
    }
    filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`);
  }

  return filters.join(',');
}

async function processVideo() {
  const inputExt = extensionFor(selectedFile);
  const input = `input.${inputExt === 'audio' ? 'mp4' : inputExt}`;
  const output = 'output.mp4';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));

  const meta = await readMediaMetadata(selectedFile);
  const filter = buildVideoFilter(meta.width || 1280, meta.height || 720);
  const args = ['-i', input];
  if (filter) args.push('-vf', filter);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', $('quality')?.value || '22');
  if (($('audioMode')?.value || 'keep') === 'mute') args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '160k');
  args.push('-movflags', '+faststart', output);

  const code = await ffmpeg.exec(args);
  if (code !== 0) throw new Error('FFmpeg could not encode this video.');
  return output;
}

async function processAudio() {
  const ext = extensionFor(selectedFile);
  const input = `input.${ext === 'audio' ? 'm4a' : ext}`;
  const output = 'output.mp3';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));
  const code = await ffmpeg.exec(['-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', $('bitrate')?.value || '192k', output]);
  if (code !== 0) throw new Error('FFmpeg could not create the MP3.');
  return output;
}

async function processFile() {
  if (!selectedFile || processing) return;
  processing = true;
  processButton.disabled = true;
  hide(download);
  setStep(1);
  setProgress(2, 'Preparing');

  try {
    await ensureFFmpeg();
    setStep(2);
    setProgress(12, 'Encoding');
    const output = sourceIsVideo ? await processVideo() : await processAudio();

    setStep(3);
    setProgress(97, 'Finishing');
    const data = await ffmpeg.readFile(output);
    const type = sourceIsVideo ? 'video/mp4' : 'audio/mpeg';
    outputUrl = URL.createObjectURL(new Blob([data.buffer], { type }));
    const baseName = inputName.replace(/\.[^.]+$/, '');
    download.href = outputUrl;
    download.download = `${baseName}_processed.${sourceIsVideo ? 'mp4' : 'mp3'}`;
    show(download);
    setProgress(100, 'Complete');
    setStep(4);
    setText('status', `Done. Output: ${formatBytes(data.byteLength)}.`);
  } catch (error) {
    console.error(error);
    setText('status', error instanceof Error ? error.message : 'Processing failed.');
    setProgress(0, 'Failed');
    setStep(1);
  } finally {
    processing = false;
    processButton.disabled = false;
    try {
      await ffmpeg.deleteFile('input.mp4');
      await ffmpeg.deleteFile('input.mov');
      await ffmpeg.deleteFile('input.webm');
      await ffmpeg.deleteFile('input.mkv');
      await ffmpeg.deleteFile('input.mp3');
      await ffmpeg.deleteFile('input.wav');
      await ffmpeg.deleteFile('input.m4a');
      await ffmpeg.deleteFile('input.aac');
      await ffmpeg.deleteFile('input.ogg');
      await ffmpeg.deleteFile('output.mp4');
      await ffmpeg.deleteFile('output.mp3');
    } catch {}
  }
}

fileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) loadFile(file);
});

drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('drag');
});
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('drag');
  const file = event.dataTransfer.files?.[0];
  if (file) loadFile(file);
});

processButton.addEventListener('click', processFile);
clearButton.addEventListener('click', reset);
