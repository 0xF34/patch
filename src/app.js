import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import './style.css';

const $ = (id) => document.getElementById(id);
const fileInput = $('file');
const drop = $('drop');
const info = $('info');
const checkCard = $('checkCard');
const checkTitle = $('checkTitle');
const checkPercent = $('checkPercent');
const checkProgress = $('checkProgress');
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
const progress = $('progress');
const progressTitle = $('progressTitle');
const progressPercent = $('progressPercent');

const ffmpeg = new FFmpeg();
let engineReady = false;
let selectedFile = null;
let mediaKind = null;
let outputUrl = null;
let previewUrl = null;
let checkTimer = null;
let processing = false;

function setBar(element, label, percent) {
  const value = Math.max(0, Math.min(100, percent));
  element.style.width = `${value}%`;
  label.textContent = `${Math.round(value)}%`;
}

function setCheck(title, percent) {
  checkTitle.textContent = title;
  setBar(checkProgress, checkPercent, percent);
}

function setProcess(title, percent, step) {
  progressTitle.textContent = title;
  setBar(progress, progressPercent, percent);
  ['step1', 'step2', 'step3'].forEach((id, index) => $(id).classList.toggle('active', index <= step));
}

function bytes(value) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = value / 1024;
  let unit = units[0];
  for (let i = 0; i < units.length - 1 && n >= 1024; i++) {
    n /= 1024;
    unit = units[i + 1];
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${unit}`;
}

function time(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ext(name) {
  const match = name.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '.bin';
}

async function loadEngine() {
  if (engineReady) return;
  setProcess('Loading FFmpeg engine…', 2, 0);
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm`)
  });
  engineReady = true;
}

ffmpeg.on('progress', ({ progress: value }) => {
  if (!processing) return;
  const percent = 10 + Math.max(0, Math.min(1, value)) * 84;
  setProcess('Encoding frames…', percent, 1);
  status.textContent = `FFmpeg is processing the media: ${Math.round(value * 100)}%`;
});

async function inspect(file) {
  const url = URL.createObjectURL(file);
  const element = document.createElement(mediaKind === 'video' ? 'video' : 'audio');
  element.preload = 'metadata';

  return new Promise((resolve, reject) => {
    element.onloadedmetadata = () => {
      const width = mediaKind === 'video' ? element.videoWidth : 0;
      const height = mediaKind === 'video' ? element.videoHeight : 0;
      $('name').textContent = file.name;
      $('size').textContent = bytes(file.size);
      $('type').textContent = file.type || ext(file.name).slice(1).toUpperCase();
      $('duration').textContent = time(element.duration);
      $('video').textContent = width ? `${width} × ${height}` : '—';
      $('audio').textContent = mediaKind === 'audio' ? 'Audio source' : 'Present if available';
      URL.revokeObjectURL(url);
      resolve({ width, height, duration: element.duration });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This browser could not read the selected media.'));
    };
    element.src = url;
  });
}

async function loadFile(file) {
  if (!file || processing) return;
  const name = file.name.toLowerCase();
  const audio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name);
  const video = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/.test(name);
  if (!audio && !video) {
    status.textContent = 'Choose MP4, MOV, WebM, MKV, MP3, WAV, M4A, AAC, OGG, or another supported media file.';
    return;
  }

  selectedFile = file;
  mediaKind = video ? 'video' : 'audio';
  info.classList.add('hidden');
  controls.classList.toggle('hidden', !video);
  watermarkControls.classList.toggle('hidden', !video);
  audioControls.classList.toggle('hidden', !audio);
  actions.classList.add('hidden');
  previewCard.classList.add('hidden');
  download.classList.add('hidden');
  checkCard.classList.remove('hidden');
  progressWrap.classList.add('hidden');
  setCheck('Reading file…', 15);
  status.textContent = 'Checking container and media metadata…';

  clearInterval(checkTimer);
  let p = 15;
  checkTimer = setInterval(() => {
    p = Math.min(82, p + 4);
    setCheck('Checking media…', p);
  }, 80);

  try {
    await inspect(file);
    clearInterval(checkTimer);
    setCheck('File checked', 100);
    await new Promise((r) => setTimeout(r, 180));

    info.classList.remove('hidden');
    actions.classList.remove('hidden');
    if (video) {
      previewCard.classList.remove('hidden');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.load();
    }
    checkCard.classList.add('hidden');
    status.textContent = 'Ready — choose settings, then Process file.';
  } catch (error) {
    clearInterval(checkTimer);
    checkCard.classList.add('hidden');
    selectedFile = null;
    status.textContent = error instanceof Error ? error.message : 'Could not inspect this file.';
  }
}

function videoFilters() {
  const filters = [];
  const resolution = $('resolution').value;
  const fps = $('fps').value;
  const rotation = $('rotation').value;
  const mirror = $('mirror').value;
  const brightness = $('brightness').value;
  const contrast = $('contrast').value;
  const preset = $('watermarkPreset').value;
  const size = Number($('watermarkSize').value) / 100;
  const band = $('watermarkBand').value;

  if (preset !== 'none') {
    // The delogo rectangle is proportional to the input width. The filter
    // accepts expressions, so it adapts to different resolutions.
    const w = `iw*${size}`;
    const h = `ih*${size * 0.45}`;
    const x = preset.includes('right') ? `iw-${w}` : preset.includes('left') ? '0' : `(iw-${w})/2`;
    const y = preset.includes('bottom') ? `ih-${h}` : preset.includes('top') ? '0' : `(ih-${h})/2`;
    filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:band=${band}`);
  }

  if (mirror === 'horizontal') filters.push('hflip');
  if (mirror === 'vertical') filters.push('vflip');
  if (rotation === '90') filters.push('transpose=1');
  if (rotation === '180') filters.push('hflip,vflip');
  if (rotation === '270') filters.push('transpose=2');
  if (brightness !== '0' || contrast !== '1') filters.push(`eq=brightness=${brightness}:contrast=${contrast}`);
  if (resolution !== 'source') filters.push(`scale=${resolution}:force_original_aspect_ratio=decrease`);
  if (fps !== 'source') filters.push(`fps=${fps}`);
  return filters;
}

async function processVideo() {
  await loadEngine();
  const input = `input${ext(selectedFile.name)}`;
  const output = 'result.mp4';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));
  const args = ['-i', input];
  const filters = videoFilters();
  if (filters.length) args.push('-vf', filters.join(','));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', $('quality').value, '-pix_fmt', 'yuv420p');
  if ($('audioMode').value === 'mute') args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', '-y', output);
  setProcess('Encoding video…', 10, 1);
  const code = await ffmpeg.exec(args);
  if (code !== 0) throw new Error(`FFmpeg stopped with code ${code}. Try a smaller resolution or shorter clip.`);
  const data = await ffmpeg.readFile(output);
  await ffmpeg.deleteFile(input).catch(() => {});
  await ffmpeg.deleteFile(output).catch(() => {});
  return new Blob([data.buffer], { type: 'video/mp4' });
}

async function processAudio() {
  await loadEngine();
  const input = `input${ext(selectedFile.name)}`;
  const output = 'result.mp3';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));
  setProcess('Encoding MP3…', 10, 1);
  const code = await ffmpeg.exec(['-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', $('bitrate').value, '-y', output]);
  if (code !== 0) throw new Error(`FFmpeg stopped with code ${code}.`);
  const data = await ffmpeg.readFile(output);
  await ffmpeg.deleteFile(input).catch(() => {});
  await ffmpeg.deleteFile(output).catch(() => {});
  return new Blob([data.buffer], { type: 'audio/mpeg' });
}

async function processFile() {
  if (!selectedFile || processing) return;
  processing = true;
  processButton.disabled = true;
  clearButton.disabled = true;
  progressWrap.classList.remove('hidden');
  setProcess('Starting…', 1, 0);
  status.textContent = 'Starting real media processing…';

  try {
    const blob = mediaKind === 'video' ? await processVideo() : await processAudio();
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    const base = selectedFile.name.replace(/\.[^.]+$/, '');
    download.href = outputUrl;
    download.download = mediaKind === 'video' ? `${base}_processed.mp4` : `${base}_converted.mp3`;
    download.textContent = `Download ${mediaKind === 'video' ? 'processed MP4' : 'MP3'} · ${bytes(blob.size)}`;
    download.classList.remove('hidden');
    setProcess('Complete', 100, 2);
    status.textContent = 'Finished. This output was actually encoded by FFmpeg.';
  } catch (error) {
    setProcess('Processing failed', 0, 0);
    status.textContent = error instanceof Error ? error.message : 'Processing failed.';
  } finally {
    processing = false;
    processButton.disabled = false;
    clearButton.disabled = false;
  }
}

function reset() {
  selectedFile = null;
  mediaKind = null;
  fileInput.value = '';
  info.classList.add('hidden');
  controls.classList.add('hidden');
  watermarkControls.classList.add('hidden');
  audioControls.classList.add('hidden');
  previewCard.classList.add('hidden');
  actions.classList.add('hidden');
  checkCard.classList.add('hidden');
  progressWrap.classList.add('hidden');
  download.classList.add('hidden');
  clearInterval(checkTimer);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  outputUrl = null;
  previewUrl = null;
  preview.removeAttribute('src');
  preview.load();
  setCheck('Checking file…', 0);
  setProcess('Preparing', 0, 0);
  status.textContent = 'Waiting for a file.';
}

fileInput.addEventListener('change', (event) => loadFile(event.target.files?.[0]));
drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('drag');
  loadFile(event.dataTransfer.files?.[0]);
});
processButton.addEventListener('click', processFile);
clearButton.addEventListener('click', reset);
