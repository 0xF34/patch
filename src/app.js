import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import './style.css';

const fileInput = document.querySelector('#file');
const drop = document.querySelector('#drop');
const info = document.querySelector('#info');
const controls = document.querySelector('#controls');
const audioControls = document.querySelector('#audioControls');
const actions = document.querySelector('#actions');
const processButton = document.querySelector('#process');
const clearButton = document.querySelector('#clear');
const download = document.querySelector('#download');
const status = document.querySelector('#status');
const progressWrap = document.querySelector('#progressWrap');
const progress = document.querySelector('#progress');

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let selectedFile = null;
let outputUrl = null;
let mediaKind = null;

const get = (id) => document.getElementById(id);

function formatBytes(bytes) {
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

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function setProgress(value) {
  const safe = Math.max(0, Math.min(1, value));
  progress.style.width = `${safe * 100}%`;
}

async function loadEngine() {
  if (ffmpegLoaded) return;

  status.textContent = 'Loading the media engine for the first time…';
  processButton.disabled = true;

  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  });

  ffmpegLoaded = true;
  processButton.disabled = false;
}

ffmpeg.on('progress', ({ progress: value }) => {
  setProgress(value);
  status.textContent = `Processing… ${Math.round(value * 100)}%`;
});

async function inspectMedia(file) {
  const url = URL.createObjectURL(file);
  const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
  media.preload = 'metadata';

  try {
    const metadata = await new Promise((resolve, reject) => {
      media.onloadedmetadata = () => resolve(media);
      media.onerror = () => reject(new Error('The browser could not read this media file.'));
      media.src = url;
    });

    let width = null;
    let height = null;
    if (mediaKind === 'video') {
      width = metadata.videoWidth;
      height = metadata.videoHeight;
    }

    get('name').textContent = file.name;
    get('size').textContent = formatBytes(file.size);
    get('type').textContent = file.type || 'Unknown';
    get('duration').textContent = formatTime(metadata.duration);
    get('video').textContent = width && height ? `${width} × ${height}` : '—';
    get('audio').textContent = mediaKind === 'audio' ? 'Audio file' : 'Available if present';

    info.classList.remove('hidden');
    actions.classList.remove('hidden');
    if (mediaKind === 'video') controls.classList.remove('hidden');
    else audioControls.classList.remove('hidden');
    status.textContent = 'File ready. Choose Process file.';
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadFile(file) {
  if (!file) return;

  const name = file.name.toLowerCase();
  const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name);
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/.test(name);

  if (!isAudio && !isVideo) {
    status.textContent = 'Choose a supported video or audio file.';
    return;
  }

  selectedFile = file;
  mediaKind = isAudio ? 'audio' : 'video';
  info.classList.add('hidden');
  controls.classList.toggle('hidden', mediaKind !== 'video');
  audioControls.classList.toggle('hidden', mediaKind !== 'audio');
  actions.classList.add('hidden');
  download.classList.add('hidden');
  progressWrap.classList.add('hidden');
  setProgress(0);

  try {
    await inspectMedia(file);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not read the file.';
    selectedFile = null;
  }
}

async function processVideo() {
  await loadEngine();

  const input = `input${getExtension(selectedFile.name)}`;
  const output = 'output.mp4';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));

  const args = ['-i', input];
  const resolution = get('resolution').value;
  const fps = get('fps').value;
  const quality = get('quality').value;

  const filters = [];
  if (fps !== 'source') filters.push(`fps=${fps}`);
  if (resolution !== 'source') filters.push(`scale=${resolution}:force_original_aspect_ratio=decrease`);
  if (filters.length) args.push('-vf', filters.join(','));

  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', quality, '-pix_fmt', 'yuv420p');

  if (get('audioMode').value === 'mute') args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '192k');

  args.push('-movflags', '+faststart', output);

  progressWrap.classList.remove('hidden');
  setProgress(0);
  status.textContent = 'Starting video conversion…';
  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile(output);
  await ffmpeg.deleteFile(input);
  await ffmpeg.deleteFile(output);
  return new Blob([data.buffer], { type: 'video/mp4' });
}

async function processAudio() {
  await loadEngine();

  const input = `input${getExtension(selectedFile.name)}`;
  const output = 'output.mp3';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));

  progressWrap.classList.remove('hidden');
  setProgress(0);
  status.textContent = 'Converting audio to MP3…';
  await ffmpeg.exec(['-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', get('bitrate').value, output]);

  const data = await ffmpeg.readFile(output);
  await ffmpeg.deleteFile(input);
  await ffmpeg.deleteFile(output);
  return new Blob([data.buffer], { type: 'audio/mpeg' });
}

function getExtension(name) {
  const match = name.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '.bin';
}

async function processFile() {
  if (!selectedFile) return;

  processButton.disabled = true;
  clearButton.disabled = true;

  try {
    const blob = mediaKind === 'video' ? await processVideo() : await processAudio();
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);

    const base = selectedFile.name.replace(/\.[^.]+$/, '');
    download.href = outputUrl;
    download.download = `${base}_${mediaKind === 'video' ? 'processed.mp4' : 'converted.mp3'}`;
    download.textContent = mediaKind === 'video' ? 'Download processed MP4' : 'Download MP3';
    download.classList.remove('hidden');
    setProgress(1);
    status.textContent = 'Done. The output was actually processed.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Processing failed.';
  } finally {
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
  audioControls.classList.add('hidden');
  actions.classList.add('hidden');
  progressWrap.classList.add('hidden');
  download.classList.add('hidden');
  download.removeAttribute('href');
  setProgress(0);
  status.textContent = 'Waiting for a file.';
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
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
