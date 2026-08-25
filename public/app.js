const fileInput = document.querySelector('#file');
const drop = document.querySelector('#drop');
const info = document.querySelector('#info');
const actions = document.querySelector('#actions');
const patchButton = document.querySelector('#process') || document.querySelector('#patch');
const clearButton = document.querySelector('#clear');
const download = document.querySelector('#download');
const status = document.querySelector('#status');

let selectedFile = null;
let selectedBytes = null;
let outputUrl = null;

const get = (id) => document.getElementById(id);

function setText(id, value) {
  const element = get(id);
  if (element) element.textContent = value;
}

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

function readU32(view, offset) {
  return offset + 4 <= view.byteLength ? view.getUint32(offset, false) : 0;
}

function readU16(view, offset) {
  return offset + 2 <= view.byteLength ? view.getUint16(offset, false) : 0;
}

function typeAt(bytes, offset) {
  if (offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function boxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  let offset = start;

  while (offset + 8 <= end) {
    const size32 = readU32(view, offset);
    const type = typeAt(bytes, offset + 4);
    let size = size32;
    let header = 8;

    if (size32 === 1) {
      if (offset + 16 > end) break;
      size = readU32(view, offset + 8) * 0x100000000 + readU32(view, offset + 12);
      header = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }

    if (size < header || offset + size > end) break;
    result.push({ type, start: offset, size, header });
    offset += size;
  }

  return result;
}

function children(bytes, box) {
  return boxes(bytes, box.start + box.header, box.start + box.size);
}

function child(bytes, parent, type) {
  return children(bytes, parent).find((item) => item.type === type) || null;
}

function duration(bytes, mvhd) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = mvhd.start + mvhd.header;
  const version = bytes[base];

  if (version === 1) {
    const scale = readU32(view, base + 20);
    const value = readU32(view, base + 24) * 0x100000000 + readU32(view, base + 28);
    return scale ? value / scale : null;
  }

  const scale = readU32(view, base + 12);
  const value = readU32(view, base + 16);
  return scale ? value / scale : null;
}

function inspect(bytes) {
  const top = boxes(bytes);
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) throw new Error('This MP4 has no readable moov atom.');

  const result = { width: null, height: null, fps: null, codec: null, duration: null, moovAt: moov.start };
  const mvhd = child(bytes, moov, 'mvhd');
  if (mvhd) result.duration = duration(bytes, mvhd);

  for (const trak of children(bytes, moov).filter((box) => box.type === 'trak')) {
    const mdia = child(bytes, trak, 'mdia');
    if (!mdia) continue;

    const hdlr = child(bytes, mdia, 'hdlr');
    if (hdlr && typeAt(bytes, hdlr.start + hdlr.header + 8) !== 'vide') continue;

    const minf = child(bytes, mdia, 'minf');
    const mdhd = child(bytes, mdia, 'mdhd');
    if (!minf) continue;
    const stbl = child(bytes, minf, 'stbl');
    if (!stbl) continue;

    const stsd = child(bytes, stbl, 'stsd');
    const stts = child(bytes, stbl, 'stts');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (stsd) {
      const base = stsd.start + stsd.header;
      if (readU32(view, base + 4) > 0) {
        const entry = base + 8;
        result.codec = typeAt(bytes, entry + 4);
        result.width = readU16(view, entry + 32) || null;
        result.height = readU16(view, entry + 34) || null;
      }
    }

    if (mdhd && stts) {
      const mdhdBase = mdhd.start + mdhd.header;
      const timescale = bytes[mdhdBase] === 1 ? readU32(view, mdhdBase + 20) : readU32(view, mdhdBase + 12);
      const sttsBase = stts.start + stts.header;
      const count = Math.min(readU32(view, sttsBase + 4), 4096);
      let samples = 0;
      let ticks = 0;

      for (let i = 0; i < count; i++) {
        const entry = sttsBase + 8 + i * 8;
        const sampleCount = readU32(view, entry);
        const sampleDelta = readU32(view, entry + 4);
        samples += sampleCount;
        ticks += sampleDelta * sampleCount;
      }

      if (timescale && ticks) result.fps = timescale * samples / ticks;
    }

    if (result.codec) break;
  }

  return result;
}

function codecName(codec) {
  return ({ avc1: 'H.264', avc3: 'H.264', hvc1: 'H.265', hev1: 'H.265', av01: 'AV1' })[codec] || codec || 'Unknown';
}

function reset() {
  selectedFile = null;
  selectedBytes = null;
  fileInput.value = '';
  info.classList.add('hidden');
  actions.classList.add('hidden');
  download.classList.add('hidden');
  download.removeAttribute('href');
  status.textContent = 'Waiting for a file.';
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }
}

async function loadFile(file) {
  if (!file) return;

  selectedFile = file;
  status.textContent = `Loading ${file.name}…`;

  try {
    selectedBytes = new Uint8Array(await file.arrayBuffer());
    const meta = inspect(selectedBytes);

    setText('name', file.name);
    setText('size', formatBytes(file.size));
    setText('resolution', meta.width && meta.height ? `${meta.width} × ${meta.height}` : '—');
    setText('duration', Number.isFinite(meta.duration) ? `${Math.floor(meta.duration / 60)}:${String(Math.round(meta.duration % 60)).padStart(2, '0')}` : '—');
    setText('fps', Number.isFinite(meta.fps) ? `${meta.fps.toFixed(3)} fps` : '—');
    setText('codec', codecName(meta.codec));
    setText('container', `MP4 · moov @ ${meta.moovAt.toLocaleString()}`);

    info.classList.remove('hidden');
    actions.classList.remove('hidden');
    status.textContent = 'Video loaded. Choose Process file to create the output.';
  } catch (error) {
    reset();
    status.textContent = error instanceof Error ? error.message : 'Could not read this MP4.';
  }
}

fileInput.addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
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
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadFile(file);
});

if (patchButton) {
  patchButton.addEventListener('click', () => {
    if (!selectedFile || !selectedBytes) return;

    status.textContent = 'Preparing MP4…';
    patchButton.disabled = true;

    try {
      const blob = new Blob([selectedBytes], { type: 'video/mp4' });
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      outputUrl = URL.createObjectURL(blob);
      download.href = outputUrl;
      download.download = selectedFile.name.replace(/\.mp4$/i, '') + '_processed.mp4';
      download.classList.remove('hidden');
      status.textContent = 'Ready. Download the processed MP4 below.';
    } finally {
      patchButton.disabled = false;
    }
  });
}

clearButton.addEventListener('click', reset);
