import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core/dist/esm/ffmpeg-core.js?url';
import wasmURL from '@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url';

const $ = id => document.getElementById(id);
const fileInput = $('file');
const drop = $('drop');
const info = $('info');
const previewCard = $('previewCard');
const preview = $('preview');
const actions = $('actions');
const processButton = $('process');
const clearButton = $('clear');
const download = $('download');
const progressWrap = $('progressWrap');
const status = $('status');

let ffmpeg = null;
let loading = null;
let selectedFile = null;
let sourceUrl = null;
let outputUrl = null;
let processing = false;
let sourceVideo = false;
let sourceAudio = false;
let meta = { width: 0, height: 0, duration: 0 };
let logPanel = null;

function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
function show(el) { el?.classList.remove('hidden'); }
function hide(el) { el?.classList.add('hidden'); }
function bytes(n) { if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
function duration(n) { if (!Number.isFinite(n)) return '—'; const s = Math.round(n); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function resValue(v) { if (!v || v === 'source') return null; const [w, h] = v.split(':').map(Number); return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null; }

function log(message, type = 'info') {
  if (!logPanel) {
    logPanel = document.createElement('div');
    logPanel.id = 'liveLog';
    Object.assign(logPanel.style, { marginTop: '12px', background: '#050505', border: '1px solid #252525', borderRadius: '12px', padding: '10px', font: '12px ui-monospace,monospace', color: '#aaa', maxHeight: '220px', overflowY: 'auto', whiteSpace: 'pre-wrap' });
    const title = document.createElement('div');
    title.textContent = 'LIVE LOG';
    title.style.cssText = 'color:#fff;font-weight:700;margin-bottom:8px;letter-spacing:.08em';
    logPanel.appendChild(title);
    (progressWrap?.parentElement || document.body).appendChild(logPanel);
  }
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  line.style.color = type === 'error' ? '#ff6b6b' : type === 'ok' ? '#8cffb0' : '#aaa';
  logPanel.appendChild(line);
  logPanel.scrollTop = logPanel.scrollHeight;
}

function setStage(title, step) {
  setText('progressTitle', title);
  [1, 2, 3].forEach(i => { const el = $(`step${i}`); if (el) { el.classList.toggle('active', i === step); el.classList.toggle('done', i < step); } });
  show(progressWrap);
}

function livePreview() {
  if (!sourceVideo || !preview) return;
  const brightness = Number($('brightness')?.value ?? 0);
  const contrast = Number($('contrast')?.value ?? 1);
  const rotation = $('rotation')?.value || '0';
  const mirror = $('mirror')?.value || 'none';
  const fps = $('fps')?.value || 'source';
  const res = resValue($('resolution')?.value);
  preview.style.filter = `brightness(${Math.max(0, 1 + brightness)}) contrast(${Math.max(0, contrast)})`;
  const transforms = [];
  if (rotation === '90') transforms.push('rotate(90deg)');
  if (rotation === '180') transforms.push('rotate(180deg)');
  if (rotation === '270') transforms.push('rotate(270deg)');
  if (mirror === 'horizontal') transforms.push('scaleX(-1)');
  if (mirror === 'vertical') transforms.push('scaleY(-1)');
  preview.style.transform = transforms.join(' ') || 'none';
  if (res) { previewCard.style.aspectRatio = `${res.w}/${res.h}`; preview.style.width = '100%'; preview.style.height = '100%'; preview.style.objectFit = 'contain'; }
  else { previewCard.style.aspectRatio = ''; preview.style.width = '100%'; preview.style.height = 'auto'; }
  setText('brightnessValue', brightness.toFixed(2));
  setText('contrastValue', contrast.toFixed(2));
}

async function readMetadata(file) {
  const url = URL.createObjectURL(file);
  const media = document.createElement(sourceAudio && !sourceVideo ? 'audio' : 'video');
  media.preload = 'metadata';
  media.src = url;
  return new Promise((resolve, reject) => {
    media.onloadedmetadata = () => { const result = { width: media.videoWidth || 0, height: media.videoHeight || 0, duration: media.duration }; URL.revokeObjectURL(url); resolve(result); };
    media.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this media file.')); };
  });
}

function videoFilters() {
  const filters = [];
  const res = resValue($('resolution')?.value);
  const fps = $('fps')?.value || 'source';
  const brightness = Number($('brightness')?.value ?? 0);
  const contrast = Number($('contrast')?.value ?? 1);
  const rotation = $('rotation')?.value || '0';
  const mirror = $('mirror')?.value || 'none';
  const watermark = $('watermarkPreset')?.value || 'none';
  const size = Number($('watermarkSize')?.value || 12) / 100;
  if (res) filters.push(`scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2`);
  if (fps !== 'source') filters.push(`fps=${fps}`);
  if (brightness !== 0 || contrast !== 1) filters.push(`eq=brightness=${Math.max(-1, Math.min(1, brightness))}:contrast=${Math.max(0, Math.min(3, contrast))}`);
  if (mirror === 'horizontal') filters.push('hflip');
  if (mirror === 'vertical') filters.push('vflip');
  if (rotation === '90') filters.push('transpose=1');
  if (rotation === '180') filters.push('transpose=2,transpose=2');
  if (rotation === '270') filters.push('transpose=2');
  if (watermark !== 'none' && meta.width && meta.height) {
    const w = Math.max(12, Math.round(meta.width * size));
    const h = Math.max(12, Math.round(meta.height * size * 0.65));
    const marginX = Math.round(meta.width * 0.02), marginY = Math.round(meta.height * 0.02);
    let x = (meta.width - w) / 2, y = (meta.height - h) / 2;
    if (watermark.includes('left')) x = marginX;
    if (watermark.includes('right')) x = meta.width - w - marginX;
    if (watermark.includes('top')) y = marginY;
    if (watermark.includes('bottom')) y = meta.height - h - marginY;
    filters.push(`delogo=x=${Math.max(0, Math.round(x))}:y=${Math.max(0, Math.round(y))}:w=${w}:h=${h}:show=0`);
  }
  return filters.join(',');
}

async function ensureFFmpeg() {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    setStage('Loading FFmpeg engine', 1);
    setText('status', 'Loading local FFmpeg engine…');
    log('Creating FFmpeg instance');
    const engine = new FFmpeg();
    engine.on('log', ({ message }) => message && log(message));
    log('Using locally bundled FFmpeg core');
    log(`Core JS: ${coreURL}`);
    log(`Core WASM: ${wasmURL}`);
    log('Calling ffmpeg.load()');
    await engine.load({ coreURL, wasmURL });
    log('ffmpeg.load() completed', 'ok');
    ffmpeg = engine;
    setText('status', 'Encoder ready. Processing…');
    return engine;
  })();
  try { return await loading; }
  catch (error) { ffmpeg = null; log(`FFmpeg initialization failed: ${error?.message || error}`, 'error'); throw error; }
  finally { loading = null; }
}

async function processFile() {
  if (!selectedFile || processing) return;
  processing = true;
  hide(download);
  if (processButton) processButton.disabled = true;
  try {
    const engine = await ensureFFmpeg();
    setStage('Preparing input', 2);
    log(`Writing ${selectedFile.name} to FFmpeg filesystem`);
    const ext = selectedFile.name.split('.').pop()?.toLowerCase() || (sourceAudio ? 'mp3' : 'mp4');
    const input = `input.${ext}`;
    const output = sourceAudio ? 'output.mp3' : 'output.mp4';
    await engine.writeFile(input, await fetchFile(selectedFile));
    let args;
    if (sourceAudio) {
      args = ['-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', $('bitrate')?.value || '192k', '-y', output];
    } else {
      args = ['-i', input];
      const vf = videoFilters();
      if (vf) args.push('-vf', vf);
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', $('quality')?.value || '22', '-pix_fmt', 'yuv420p');
      if (($('audioMode')?.value || 'keep') === 'mute') args.push('-an');
      else args.push('-c:a', 'aac', '-b:a', '192k');
      args.push('-movflags', '+faststart', '-y', output);
    }
    log(`Running FFmpeg: ${args.join(' ')}`);
    await engine.exec(args);
    log('FFmpeg finished successfully', 'ok');
    setStage('Finishing output', 3);
    const data = await engine.readFile(output);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: sourceAudio ? 'audio/mpeg' : 'video/mp4' }));
    download.href = outputUrl;
    download.download = output;
    download.textContent = `Download modified ${sourceAudio ? 'MP3' : 'MP4'}`;
    show(download);
    setText('status', 'Done — the output contains your selected changes.');
    log(`Output ready: ${bytes(data.byteLength ?? data.length)}`, 'ok');
  } catch (error) {
    console.error(error);
    setText('status', error instanceof Error ? error.message : 'Processing failed.');
    log(`PROCESSING ERROR: ${error?.message || error}`, 'error');
  } finally {
    processing = false;
    if (processButton) processButton.disabled = false;
  }
}

async function loadFile(file) {
  if (!file || processing) return;
  selectedFile = file;
  sourceVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(file.name);
  sourceAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name);
  try {
    setStage('Checking file', 1);
    log(`Selected ${file.name} (${bytes(file.size)})`);
    meta = await readMetadata(file);
    setText('name', file.name); setText('size', bytes(file.size)); setText('duration', duration(meta.duration));
    setText('type', sourceVideo ? 'VIDEO' : 'AUDIO'); setText('video', sourceVideo ? `${meta.width} × ${meta.height}` : 'None'); setText('audio', sourceVideo || sourceAudio ? 'Available' : 'None');
    show(info); show(actions);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    if (sourceVideo) { preview.src = sourceUrl; show(previewCard); preview.onloadedmetadata = livePreview; livePreview(); } else hide(previewCard);
    log('Metadata read successfully', 'ok');
    setText('status', 'File checked. Starting automatic processing…');
    await processFile();
  } catch (error) { setText('status', error instanceof Error ? error.message : 'Could not read the file.'); log(`FILE ERROR: ${error?.message || error}`, 'error'); }
}

function reset() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  sourceUrl = outputUrl = null; selectedFile = null; sourceVideo = sourceAudio = false;
  if (fileInput) fileInput.value = '';
  if (preview) { preview.pause(); preview.removeAttribute('src'); preview.load(); preview.style.filter = 'none'; preview.style.transform = 'none'; }
  hide(info); hide(previewCard); hide(actions); hide(download); hide(progressWrap);
  if (logPanel) { logPanel.remove(); logPanel = null; }
  setText('status', 'Set your options, then choose a file.');
}

fileInput?.addEventListener('change', e => loadFile(e.target.files?.[0]));
drop?.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
drop?.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop?.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); loadFile(e.dataTransfer?.files?.[0]); });
processButton?.addEventListener('click', processFile);
clearButton?.addEventListener('click', reset);
['fps','resolution','quality','audioMode','rotation','mirror','brightness','contrast','watermarkPreset','watermarkSize','bitrate'].forEach(id => { const el = $(id); el?.addEventListener('input', livePreview); el?.addEventListener('change', livePreview); });
livePreview();
