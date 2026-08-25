import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import './style.css';

const fileInput = document.querySelector('#file');
const drop = document.querySelector('#drop');
const info = document.querySelector('#info');
const previewCard = document.querySelector('#previewCard');
const preview = document.querySelector('#preview');
const controls = document.querySelector('#controls');
const audioControls = document.querySelector('#audioControls');
const cropControls = document.querySelector('#cropControls');
const actions = document.querySelector('#actions');
const processButton = document.querySelector('#process');
const clearButton = document.querySelector('#clear');
const download = document.querySelector('#download');
const status = document.querySelector('#status');
const progressWrap = document.querySelector('#progressWrap');
const progress = document.querySelector('#progress');
const progressTitle = document.querySelector('#progressTitle');
const progressPercent = document.querySelector('#progressPercent');

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let selectedFile = null;
let outputUrl = null;
let previewUrl = null;
let mediaKind = null;
let progressTimer = null;
let realProgress = 0;

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
  realProgress = Math.max(0, Math.min(1, value));
  progress.style.width = `${realProgress * 100}%`;
  progressPercent.textContent = `${Math.round(realProgress * 100)}%`;
}

function showStage(title, value, activeStep) {
  progressTitle.textContent = title;
  setProgress(value);
  ['step1', 'step2', 'step3'].forEach((id, index) => {
    get(id).classList.toggle('active', index <= activeStep);
  });
}

function startProgressAnimation(target = 0.08) {
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (realProgress < target) setProgress(Math.min(target, realProgress + 0.01));
  }, 180);
}

function stopProgressAnimation() {
  clearInterval(progressTimer);
  progressTimer = null;
}

async function loadEngine() {
  if (ffmpegLoaded) return;

  progressWrap.classList.remove('hidden');
  showStage('Loading media engine…', 0.02, 0);
  startProgressAnimation(0.12);

  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  });

  ffmpegLoaded = true;
  stopProgressAnimation();
}

ffmpeg.on('progress', ({ progress: value }) => {
  const scaled = 0.12 + Math.max(0, Math.min(1, value)) * 0.82;
  showStage('Encoding…', scaled, 1);
  status.textContent = `Processing frames… ${Math.round(value * 100)}%`;
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

    const width = mediaKind === 'video' ? metadata.videoWidth : null;
    const height = mediaKind === 'video' ? metadata.videoHeight : null;

    get('name').textContent = file.name;
    get('size').textContent = formatBytes(file.size);
    get('type').textContent = file.type || 'Unknown';
    get('duration').textContent = formatTime(metadata.duration);
    get('video').textContent = width && height ? `${width} × ${height}` : '—';
    get('audio').textContent = mediaKind === 'audio' ? 'Audio file' : 'Available if present';

    info.classList.remove('hidden');
    actions.classList.remove('hidden');
    if (mediaKind === 'video') {
      controls.classList.remove('hidden');
      cropControls.classList.remove('hidden');
      previewCard.classList.remove('hidden');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      preview.src = previewUrl;
      return;
    }

    audioControls.classList.remove('hidden');
    URL.revokeObjectURL(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
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
  cropControls.classList.toggle('hidden', mediaKind !== 'video');
  audioControls.classList.toggle('hidden', mediaKind !== 'audio');
  actions.classList.add('hidden');
  previewCard.classList.add('hidden');
  download.classList.add('hidden');
  progressWrap.classList.add('hidden');
  setProgress(0);
  status.textContent = 'Reading media…';

  try {
    await inspectMedia(file);
    status.textContent = 'Ready. Settings can now be changed before processing.';
  } catch (error) {
    selectedFile = null;
    status.textContent = error instanceof Error ? error.message : 'Could not read the file.';
  }
}

function buildVideoFilters() {
  const filters = [];
  const resolution = get('resolution').value;
  const rotation = get('rotation').value;
  const mirror = get('mirror').value;
  const brightness = get('brightness').value;
  const contrast = get('contrast').value;
  const crop = get('cropPreset').value;

  if (crop === 'center') filters.push("crop=iw*0.9:ih*0.9");
  if (crop === 'bottom') filters.push("crop=iw:ih*0.92:0:0");
  if (crop === 'top') filters.push("crop=iw:ih*0.92:0:ih*0.08");
  if (crop === 'left') filters.push("crop=iw*0.92:ih:iw*0.08:0");
  if (crop === 'right') filters.push("crop=iw*0.92:ih:0:0");

  if (mirror === 'horizontal') filters.push('hflip');
  if (mirror === 'vertical') filters.push('vflip');
  if (rotation === '90') filters.push('transpose=1');
  if (rotation === '180') filters.push('hflip,vflip');
  if (rotation === '270') filters.push('transpose=2');
  if (brightness !== '0' || contrast !== '1') filters.push(`eq=brightness=${brightness}:contrast=${contrast}`);
  if (resolution !== 'source') filters.push(`scale=${resolution}:force_original_aspect_ratio=decrease`);

  if (get('fps').value !== 'source') filters.push(`fps=${get('fps').value}`);
  return filters;
}

async function processVideo() {
  await loadEngine();

  const input = `input${getExtension(selectedFile.name)}`;
  const output = 'output.mp4';
  showStage('Preparing encode…', Math.max(realProgress, 0.12), 0);
  status.textContent = 'Writing source into the local media engine…';
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));

  const args = ['-i', input];
  const filters = buildVideoFilters();
  if (filters.length) args.push('-vf', filters.join(','));

  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', get('quality').value, '-pix_fmt', 'yuv420p');
  if (get('audioMode').value === 'mute') args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', '-y', output);

  showStage('Encoding video…', 0.12, 1);
  status.textContent = 'Real frame processing is running. This can take a while on iPhone.';
  await ffmpeg.exec(args);

  showStage('Finalizing file…', 0.96, 2);
  const data = await ffmpeg.readFile(output);
  await ffmpeg.deleteFile(input);
  await ffmpeg.deleteFile(output);
  return new Blob([data.buffer], { type: 'video/mp4' });
}

async function processAudio() {
  await loadEngine();
  const input = `input${getExtension(selectedFile.name)}`;
  const output = 'output.mp3';
  showStage('Preparing audio…', Math.max(realProgress, 0.12), 0);
  await ffmpeg.writeFile(input, await fetchFile(selectedFile));
  showStage('Encoding MP3…', 0.12, 1);
  await ffmpeg.exec(['-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', get('bitrate').value, '-y', output]);
  showStage('Finalizing file…', 0.96, 2);
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
  progressWrap.classList.remove('hidden');
  stopProgressAnimation();
  setProgress(0);

  try {
    const blob = mediaKind === 'video' ? await processVideo() : await processAudio();
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    const base = selectedFile.name.replace(/\.[^.]+$/, '');
    download.href = outputUrl;
    download.download = `${base}_${mediaKind === 'video' ? 'processed.mp4' : 'converted.mp3'}`;
    download.textContent = mediaKind === 'video' ? 'Download processed MP4' : 'Download MP3';
    download.classList.remove('hidden');
    showStage('Complete', 1, 2);
    status.textContent = `Done. Output size: ${formatBytes(blob.size)}. The file was actually re-encoded.`;
  } catch (error) {
    showStage('Processing failed', realProgress, 1);
    status.textContent = error instanceof Error ? error.message : 'Processing failed.';
  } finally {
    processButton.disabled = false;
    clearButton.disabled = false;
    stopProgressAnimation();
  }
}

function reset() {
  selectedFile = null;
  mediaKind = null;
  fileInput.value = '';
  info.classList.add('hidden');
  controls.classList.add('hidden');
  cropControls.classList.add('hidden');
  audioControls.classList.add('hidden');
  previewCard.classList.add('hidden');
  actions.classList.add('hidden');
  progressWrap.classList.add('hidden');
  download.classList.add('hidden');
  download.removeAttribute('href');
  stopProgressAnimation();
  setProgress(0);
  status.textContent = 'Waiting for a file.';
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  outputUrl = null;
  previewUrl = null;
  preview.removeAttribute('src');
  preview.load();
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
