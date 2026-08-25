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
let ffmpegLoading = null;
let selectedFile = null;
let outputUrl = null;
let inputName = '';
let sourceUrl = null;
let sourceIsVideo = false;
let sourceIsAudio = false;
let processing = false;
let previewOverlay = null;
let previewBadge = null;

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function show(node) { node?.classList.remove('hidden'); }
function hide(node) { node?.classList.add('hidden'); }

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
  if (progressBar) progressBar.style.width = `${value}%`;
  setText('progressPercent', `${value}%`);
  setText('progressTitle', title);
}

function setStep(step) {
  ['step1', 'step2', 'step3'].forEach((id, index) => {
    const node = $(id);
    if (!node) return;
    node.classList.toggle('active', index + 1 === step);
    node.classList.toggle('done', index + 1 < step);
  });
}

function safeInputName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extensionFor(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return ext;
  if (file.type.startsWith('audio/')) return 'm4a';
  return ['mp4', 'mov', 'webm', 'mkv'].includes(ext) ? ext : 'mp4';
}

function ensurePreviewLayer() {
  if (!previewCard || !preview) return;
  if (!previewCard.style.position) previewCard.style.position = 'relative';

  if (!previewOverlay) {
    previewOverlay = document.createElement('div');
    previewOverlay.setAttribute('aria-hidden', 'true');
    Object.assign(previewOverlay.style, {
      position: 'absolute',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '4',
      borderRadius: '10px',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      background: 'rgba(0,0,0,.18)',
      border: '1px solid rgba(255,255,255,.12)',
      boxSizing: 'border-box'
    });
    previewCard.appendChild(previewOverlay);
  }

  if (!previewBadge) {
    previewBadge = document.createElement('div');
    previewBadge.setAttribute('aria-hidden', 'true');
    Object.assign(previewBadge.style, {
      position: 'absolute',
      left: '14px',
      top: '14px',
      zIndex: '5',
      pointerEvents: 'none',
      padding: '7px 10px',
      borderRadius: '999px',
      background: 'rgba(0,0,0,.72)',
      border: '1px solid rgba(255,255,255,.16)',
      color: '#fff',
      font: '600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif',
      letterSpacing: '.02em',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)'
    });
    previewCard.appendChild(previewBadge);
  }
}

function parseResolution(value) {
  if (!value || value === 'source') return null;
  const [w, h] = value.split(':').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

function updateLivePreview() {
  if (!sourceIsVideo || !selectedFile || !preview) return;
  ensurePreviewLayer();

  const fps = $('fps')?.value || 'source';
  const resolution = $('resolution')?.value || 'source';
  const brightness = Number($('brightness')?.value || 0);
  const contrast = Number($('contrast')?.value || 1);
  const rotation = $('rotation')?.value || '0';
  const mirror = $('mirror')?.value || 'none';
  const preset = $('watermarkPreset')?.value || 'none';
  const size = Number($('watermarkSize')?.value || 12);
  const target = parseResolution(resolution);

  // CSS is used for the live preview so changes appear immediately without
  // waiting for FFmpeg to re-encode the whole file. The downloaded file still
  // uses the real FFmpeg filters when Process file is run.
  const filters = [];
  if (brightness !== 0 || contrast !== 1) {
    filters.push(`brightness(${1 + brightness})`, `contrast(${contrast})`);
  }
  preview.style.filter = filters.length ? filters.join(' ') : 'none';

  let transform = '';
  if (rotation === '90') transform += 'rotate(90deg)';
  if (rotation === '180') transform += 'rotate(180deg)';
  if (rotation === '270') transform += 'rotate(270deg)';
  if (mirror === 'horizontal') transform += ' scaleX(-1)';
  if (mirror === 'vertical') transform += ' scaleY(-1)';
  preview.style.transform = transform.trim() || 'none';
  preview.style.transformOrigin = 'center center';
  preview.style.transition = 'filter .12s ease, transform .12s ease';

  // Make the preview frame reflect the selected output dimensions/aspect.
  if (target) {
    previewCard.style.aspectRatio = `${target.w} / ${target.h}`;
    preview.style.width = '100%';
    preview.style.height = '100%';
    preview.style.objectFit = 'contain';
  } else {
    previewCard.style.aspectRatio = '';
    preview.style.width = '100%';
    preview.style.height = 'auto';
    preview.style.objectFit = 'contain';
  }

  if (previewBadge) {
    const fpsText = fps === 'source' ? 'Source FPS' : `${fps} FPS`;
    const resText = target ? `${target.w}×${target.h}` : 'Source resolution';
    previewBadge.textContent = `LIVE PREVIEW · ${resText} · ${fpsText}`;
  }

  if (previewOverlay) {
    if (preset === 'none') {
      previewOverlay.style.display = 'none';
    } else {
      previewOverlay.style.display = 'block';
      const horizontal = preset.includes('right') ? 'right' : preset.includes('left') ? 'left' : 'center';
      const vertical = preset.includes('bottom') ? 'bottom' : preset.includes('top') ? 'top' : 'center';
      const boxW = `${Math.max(8, Math.min(35, size * 1.8))}%`;
      const boxH = `${Math.max(6, Math.min(30, size * 1.15))}%`;
      previewOverlay.style.width = boxW;
      previewOverlay.style.height = boxH;
      previewOverlay.style.left = horizontal === 'center' ? '50%' : horizontal === 'left' ? '2%' : 'auto';
      previewOverlay.style.right = horizontal === 'right' ? '2%' : 'auto';
      previewOverlay.style.top = vertical === 'center' ? '50%' : vertical === 'top' ? '2%' : 'auto';
      previewOverlay.style.bottom = vertical === 'bottom' ? '2%' : 'auto';
      previewOverlay.style.transform = 'translate(-50%, -50%)';
      if (horizontal !== 'center') previewOverlay.style.transform = vertical === 'center' ? 'translateY(-50%)' : 'none';
      if (vertical !== 'center') previewOverlay.style.transform = horizontal === 'center' ? 'translateX(-50%)' : 'none';
      if (horizontal === 'center' && vertical === 'center') previewOverlay.style.transform = 'translate(-50%, -50%)';
    }
  }
}

function attachLivePreviewListeners() {
  ['fps', 'resolution', 'quality', 'audioMode', 'rotation', 'mirror', 'brightness', 'contrast', 'watermarkPreset', 'watermarkSize', 'bitrate']
    .forEach((id) => {
      const node = $(id);
      if (!node) return;
      node.addEventListener('input', updateLivePreview);
      node.addEventListener('change', updateLivePreview);
    });
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
  preview.style.filter = 'none';
  preview.style.transform = 'none';
  previewCard.style.aspectRatio = '';
  if (previewOverlay) previewOverlay.style.display = 'none';
  if (previewBadge) previewBadge.textContent = '';
  hide(info);
  hide(previewCard);
  hide(actions);
  hide(progressWrap);
  hide(download);
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
      const result = { duration: media.duration, width: media.videoWidth || 0, height: media.videoHeight || 0 };
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
    setStep(1);
    setProgress(2, 'Checking file');
    setText('status', 'Reading media metadata…');
    const meta = await readMediaMetadata(file);

    setProgress(8, 'File ready');
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
      hide(audioControls);
      ensurePreviewLayer();
      updateLivePreview();
    } else {
      hide(previewCard);
      hide(watermarkControls);
      hide(controls);
      show(audioControls);
    }

    show(info);
    show(actions);
    setText('status', 'Preview updated live. Starting automatic processing with your selected settings…');
    await processFile();
  } catch (error) {
    reset();
    setText('status', error instanceof Error ? error.message : 'Could not read this file.');
  }
}

async function ensureFFmpeg() {
  if (ffmpegReady) return;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    setProgress(10, 'Loading encoder');
    setStep(1);
    setText('status', 'Loading FFmpeg engine (~31 MB). Keep this page open…');

    ffmpeg.on('progress', ({ progress }) => {
      if (!processing) return;
      const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      setStep(2);
      setProgress(15 + p * 80, 'Encoding');
      setText('status', `Encoding… ${Math.round(p * 100)}%`);
    });

    ffmpeg.on('log', ({ message }) => { if (message) console.debug('[FFmpeg]', message); });

    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegReady = true;
    setProgress(15, 'Encoder ready');
  })();

  try { await ffmpegLoading; } finally { ffmpegLoading = null; }
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
    filters.push(`scale=${rw}:${rh}:force_original_aspect_ratio=decrease,pad=${rw}:${rh}:(ow-iw)/2:(oh-ih)/2`);
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
    if (preset === 'center') { x = Math.round((width - w) / 2); y = Math.round((height - h) / 2); }
    filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`);
  }
  return filters.join(',');
}

async function processVideo() {
  const ext = extensionFor(selectedFile);
  const input = `input.${ext}`;
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
  const input = `input.${ext}`;
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
  setProgress(3, 'Preparing');

  try {
    await ensureFFmpeg();
    setStep(2);
    setProgress(15, 'Encoding');
    const output = sourceIsVideo ? await processVideo() : await processAudio();

    setStep(3);
    setProgress(97, 'Finishing');
    const data = await ffmpeg.readFile(output);
    const type = sourceIsVideo ? 'video/mp4' : 'audio/mpeg';
    outputUrl = URL.createObjectURL(new Blob([data], { type }));
    const baseName = inputName.replace(/\.[^.]+$/, '') || 'media';
    download.href = outputUrl;
    download.download = `${baseName}_processed.${sourceIsVideo ? 'mp4' : 'mp3'}`;
    download.textContent = `Download modified ${sourceIsVideo ? 'MP4' : 'MP3'} · ${formatBytes(data.byteLength)}`;
    show(download);
    setProgress(100, 'Complete');
    setStep(3);
    setText('status', 'Finished. Your modified file is ready below.');
  } catch (error) {
    console.error(error);
    setText('status', error instanceof Error ? error.message : 'Processing failed.');
    setProgress(0, 'Failed');
  } finally {
    processing = false;
    processButton.disabled = false;
    for (const name of ['input.mp4','input.mov','input.webm','input.mkv','input.mp3','input.wav','input.m4a','input.aac','input.ogg','output.mp4','output.mp3']) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
  }
}

fileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) loadFile(file);
});

drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('drag');
  const file = event.dataTransfer.files?.[0];
  if (file) loadFile(file);
});

processButton.addEventListener('click', processFile);
clearButton.addEventListener('click', reset);
attachLivePreviewListeners();
