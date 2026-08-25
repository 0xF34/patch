import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm';
import { fetchFile } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';

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

let ffmpeg = null;
let ffmpegReady = false;
let ffmpegLoading = null;
let selectedFile = null;
let sourceUrl = null;
let outputUrl = null;
let sourceMeta = null;
let processing = false;
let previewOverlay = null;
let previewBadge = null;

const get = (id) => $(id);
const show = (node) => node?.classList.remove('hidden');
const hide = (node) => node?.classList.add('hidden');

function text(id, value) {
  const node = get(id);
  if (node) node.textContent = value;
}

function bytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function duration(value) {
  if (!Number.isFinite(value)) return '—';
  const total = Math.max(0, Math.round(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function progress(value, title) {
  const p = Math.max(0, Math.min(100, Math.round(value)));
  show(progressWrap);
  if (progressBar) progressBar.style.width = `${p}%`;
  text('progressPercent', `${p}%`);
  text('progressTitle', title);
}

function step(active) {
  ['step1', 'step2', 'step3'].forEach((id, index) => {
    const node = get(id);
    if (!node) return;
    node.classList.toggle('active', index + 1 === active);
    node.classList.toggle('done', index + 1 < active);
  });
}

function resolutionValue() {
  const value = get('resolution')?.value || 'source';
  if (value === 'source') return null;
  const [w, h] = value.split(':').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

function makePreviewLayer() {
  if (!previewCard || !preview) return;
  previewCard.style.position = 'relative';

  if (!previewOverlay) {
    previewOverlay = document.createElement('div');
    Object.assign(previewOverlay.style, {
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      border: '1px solid rgba(255,255,255,.2)',
      background: 'rgba(0,0,0,.45)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      borderRadius: '8px',
      boxSizing: 'border-box'
    });
    previewCard.appendChild(previewOverlay);
  }

  if (!previewBadge) {
    previewBadge = document.createElement('div');
    Object.assign(previewBadge.style, {
      position: 'absolute',
      left: '12px',
      top: '12px',
      zIndex: '5',
      pointerEvents: 'none',
      padding: '7px 10px',
      borderRadius: '999px',
      color: '#fff',
      background: 'rgba(0,0,0,.75)',
      border: '1px solid rgba(255,255,255,.15)',
      font: '600 11px -apple-system,BlinkMacSystemFont,sans-serif'
    });
    previewCard.appendChild(previewBadge);
  }
}

function updatePreview() {
  if (!selectedFile || !sourceMeta || !sourceMeta.video || !preview) return;
  makePreviewLayer();

  const fps = get('fps')?.value || 'source';
  const target = resolutionValue();
  const brightness = Number(get('brightness')?.value || 0);
  const contrast = Number(get('contrast')?.value || 1);
  const rotation = get('rotation')?.value || '0';
  const mirror = get('mirror')?.value || 'none';
  const watermark = get('watermarkPreset')?.value || 'none';
  const size = Number(get('watermarkSize')?.value || 12);

  preview.style.filter = `brightness(${1 + brightness}) contrast(${contrast})`;
  const transforms = [];
  if (rotation === '90') transforms.push('rotate(90deg)');
  if (rotation === '180') transforms.push('rotate(180deg)');
  if (rotation === '270') transforms.push('rotate(270deg)');
  if (mirror === 'horizontal') transforms.push('scaleX(-1)');
  if (mirror === 'vertical') transforms.push('scaleY(-1)');
  preview.style.transform = transforms.join(' ') || 'none';
  preview.style.transformOrigin = 'center center';
  preview.style.transition = 'filter .12s ease, transform .12s ease';

  const outputW = target?.w || sourceMeta.width;
  const outputH = target?.h || sourceMeta.height;
  previewCard.style.aspectRatio = `${outputW} / ${outputH}`;
  preview.style.width = '100%';
  preview.style.height = '100%';
  preview.style.objectFit = 'contain';

  if (previewBadge) {
    previewBadge.textContent = `LIVE · ${outputW}×${outputH} · ${fps === 'source' ? 'source FPS' : `${fps} FPS`}`;
  }

  if (!previewOverlay) return;
  if (watermark === 'none') {
    previewOverlay.style.display = 'none';
    return;
  }

  previewOverlay.style.display = 'block';
  previewOverlay.style.width = `${Math.max(8, Math.min(40, size * 1.8))}%`;
  previewOverlay.style.height = `${Math.max(6, Math.min(32, size * 1.15))}%`;
  previewOverlay.style.left = watermark.includes('left') ? '2%' : watermark.includes('right') ? 'auto' : '50%';
  previewOverlay.style.right = watermark.includes('right') ? '2%' : 'auto';
  previewOverlay.style.top = watermark.includes('top') ? '2%' : watermark.includes('bottom') ? 'auto' : '50%';
  previewOverlay.style.bottom = watermark.includes('bottom') ? '2%' : 'auto';
  const centerX = !watermark.includes('left') && !watermark.includes('right');
  const centerY = !watermark.includes('top') && !watermark.includes('bottom');
  previewOverlay.style.transform = centerX && centerY ? 'translate(-50%,-50%)' : centerX ? 'translateX(-50%)' : centerY ? 'translateY(-50%)' : 'none';
}

function attachPreviewListeners() {
  ['fps', 'resolution', 'quality', 'audioMode', 'rotation', 'mirror', 'brightness', 'contrast', 'watermarkPreset', 'watermarkSize', 'bitrate'].forEach((id) => {
    const node = get(id);
    if (!node) return;
    node.addEventListener('input', updatePreview);
    node.addEventListener('change', updatePreview);
  });
}

function reset() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  sourceUrl = null;
  outputUrl = null;
  selectedFile = null;
  sourceMeta = null;
  processing = false;
  if (fileInput) fileInput.value = '';
  if (preview) {
    preview.removeAttribute('src');
    preview.load();
    preview.style.filter = 'none';
    preview.style.transform = 'none';
  }
  if (previewCard) previewCard.style.aspectRatio = '';
  if (previewOverlay) previewOverlay.style.display = 'none';
  hide(info);
  hide(previewCard);
  hide(actions);
  hide(progressWrap);
  hide(download);
  text('status', 'Set your options, then choose a file.');
  if (processButton) processButton.disabled = false;
}

async function mediaMetadata(file) {
  const url = URL.createObjectURL(file);
  const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
  media.preload = 'metadata';
  media.src = url;
  return new Promise((resolve, reject) => {
    media.onloadedmetadata = () => {
      const result = {
        duration: media.duration,
        width: media.videoWidth || 0,
        height: media.videoHeight || 0,
        video: media.tagName === 'VIDEO'
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Safari could not read this media file.'));
    };
  });
}

async function fetchBlobURL(url, type, label, start, end) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not download ${label} (${response.status}).`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !response.body.getReader) {
    const data = await response.arrayBuffer();
    progress(end, `${label} ready`);
    return URL.createObjectURL(new Blob([data], { type }));
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const ratio = total ? received / total : 0;
    progress(start + (end - start) * ratio, `Downloading ${label}`);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

async function ensureFFmpeg() {
  if (ffmpegReady && ffmpeg) return;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    if (ffmpeg) {
      try { ffmpeg.terminate(); } catch {}
    }
    ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress: value }) => {
      if (!processing) return;
      const p = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      step(2);
      progress(30 + p * 65, 'Encoding');
      text('status', `Encoding video… ${Math.round(p * 100)}%`);
    });

    ffmpeg.on('log', ({ message }) => {
      if (message) console.debug('[ffmpeg]', message);
    });

    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    progress(10, 'Starting encoder');
    text('status', 'Downloading FFmpeg core. This is the only large first-run download.');

    let coreURL;
    let wasmURL;
    try {
      coreURL = await fetchBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript', 'FFmpeg core', 10, 18);
      wasmURL = await fetchBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', 'FFmpeg WASM', 18, 29);
      progress(29, 'Initializing encoder');
      await Promise.race([
        ffmpeg.load({ coreURL, wasmURL }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('FFmpeg took too long to initialize. Reload and try again.')), 90000))
      ]);
      ffmpegReady = true;
      progress(30, 'Encoder ready');
      text('status', 'Encoder ready. Processing your file…');
    } finally {
      if (coreURL) URL.revokeObjectURL(coreURL);
      if (wasmURL) URL.revokeObjectURL(wasmURL);
    }
  })();

  try {
    await ffmpegLoading;
  } catch (error) {
    ffmpegReady = false;
    try { ffmpeg?.terminate(); } catch {}
    ffmpeg = null;
    throw error;
  } finally {
    ffmpegLoading = null;
  }
}

function inputExtension(file) {
  const match = file.name.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : (file.type.startsWith('audio/') ? 'm4a' : 'mp4');
}

function videoFilters() {
  const filters = [];
  const target = resolutionValue();
  const fps = get('fps')?.value || 'source';
  const brightness = Number(get('brightness')?.value || 0);
  const contrast = Number(get('contrast')?.value || 1);
  const rotation = get('rotation')?.value || '0';
  const mirror = get('mirror')?.value || 'none';

  if (target) filters.push(`scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2`);
  if (fps !== 'source') filters.push(`fps=${fps}`);
  if (brightness !== 0 || contrast !== 1) filters.push(`eq=brightness=${brightness}:contrast=${contrast}`);
  if (rotation === '90') filters.push('transpose=clock');
  if (rotation === '180') filters.push('transpose=clock,transpose=clock');
  if (rotation === '270') filters.push('transpose=cclock');
  if (mirror === 'horizontal') filters.push('hflip');
  if (mirror === 'vertical') filters.push('vflip');

  const preset = get('watermarkPreset')?.value || 'none';
  if (preset !== 'none' && sourceMeta?.width && sourceMeta?.height) {
    const ratio = Number(get('watermarkSize')?.value || 12) / 100;
    const w = Math.max(16, Math.round(sourceMeta.width * ratio));
    const h = Math.max(16, Math.round(sourceMeta.height * ratio));
    const marginX = Math.max(2, Math.round(sourceMeta.width * 0.02));
    const marginY = Math.max(2, Math.round(sourceMeta.height * 0.02));
    let x = marginX;
    let y = marginY;
    if (preset.includes('right')) x = sourceMeta.width - w - marginX;
    if (preset.includes('bottom')) y = sourceMeta.height - h - marginY;
    if (preset === 'center') {
      x = Math.round((sourceMeta.width - w) / 2);
      y = Math.round((sourceMeta.height - h) / 2);
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`);
  }
  return filters.join(',');
}

async function processFile() {
  if (!selectedFile || processing) return;
  processing = true;
  if (processButton) processButton.disabled = true;
  hide(download);
  setProgress(4, 'Preparing');
  step(1);

  try {
    await ensureFFmpeg();
    const inputExt = inputExtension(selectedFile);
    const input = `input.${inputExt}`;
    const isVideo = sourceMeta?.video;
    const output = isVideo ? 'media-forge-output.mp4' : 'media-forge-output.mp3';

    try { await ffmpeg.deleteFile(input); } catch {}
    try { await ffmpeg.deleteFile(output); } catch {}

    text('status', 'Copying the selected file into the local FFmpeg workspace…');
    await ffmpeg.writeFile(input, await fetchFile(selectedFile));
    progress(30, 'Encoding');
    step(2);

    let args;
    if (isVideo) {
      args = ['-i', input];
      const vf = videoFilters();
      if (vf) args.push('-vf', vf);
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', get('quality')?.value || '22', '-pix_fmt', 'yuv420p');
      if ((get('audioMode')?.value || 'keep') === 'mute') {
        args.push('-an');
      } else {
        args.push('-c:a', 'aac', '-b:a', '128k');
      }
      args.push('-movflags', '+faststart', output);
    } else {
      args = ['-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', get('bitrate')?.value || '192k', output];
    }

    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg stopped with code ${code}.`);

    step(3);
    progress(98, 'Finishing');
    const data = await ffmpeg.readFile(output);
    const mime = isVideo ? 'video/mp4' : 'audio/mpeg';
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: mime }));

    download.href = outputUrl;
    download.download = isVideo ? 'media-forge-output.mp4' : 'media-forge-output.mp3';
    download.textContent = `Download modified ${isVideo ? 'MP4' : 'MP3'} · ${bytes(data.byteLength)}`;
    show(download);
    progress(100, 'Finished');
    text('status', `Done. The output is a new ${isVideo ? 'MP4' : 'MP3'} file; your original stays unchanged.`);
  } catch (error) {
    console.error(error);
    progress(0, 'Processing failed');
    text('status', error instanceof Error ? error.message : 'Processing failed.');
  } finally {
    processing = false;
    if (processButton) processButton.disabled = false;
  }
}

async function loadFile(file) {
  if (!file || processing) return;
  if (file.size === 0) return text('status', 'That file is empty.');

  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  sourceUrl = null;
  outputUrl = null;
  selectedFile = file;
  sourceMeta = null;
  hide(download);

  try {
    progress(2, 'Checking file');
    step(1);
    text('status', 'Reading the media header…');
    sourceMeta = await mediaMetadata(file);

    text('name', file.name);
    text('size', bytes(file.size));
    text('duration', duration(sourceMeta.duration));
    text('type', sourceMeta.video ? 'VIDEO' : 'AUDIO');
    text('video', sourceMeta.video ? `${sourceMeta.width} × ${sourceMeta.height}` : 'None');
    text('audio', sourceMeta.video ? 'Available' : 'Audio');
    show(info);
    show(actions);

    sourceUrl = URL.createObjectURL(file);
    if (sourceMeta.video) {
      preview.src = sourceUrl;
      show(previewCard);
      show(controls);
      show(watermarkControls);
      hide(audioControls);
      makePreviewLayer();
      updatePreview();
    } else {
      hide(previewCard);
      hide(controls);
      hide(watermarkControls);
      show(audioControls);
    }

    progress(7, 'File ready');
    text('status', 'File checked. Starting automatic processing…');
    await processFile();
  } catch (error) {
    console.error(error);
    text('status', error instanceof Error ? error.message : 'Could not read this file.');
  }
}

fileInput?.addEventListener('change', () => loadFile(fileInput.files?.[0]));

drop?.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('dragging');
});
drop?.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop?.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('dragging');
  loadFile(event.dataTransfer?.files?.[0]);
});

processButton?.addEventListener('click', processFile);
clearButton?.addEventListener('click', reset);
attachPreviewListeners();
reset();
