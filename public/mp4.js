const TEXT = new TextDecoder();

function u32(view, offset) {
  return offset + 4 <= view.byteLength ? view.getUint32(offset, false) : 0;
}

function u16(view, offset) {
  return offset + 2 <= view.byteLength ? view.getUint16(offset, false) : 0;
}

function fourcc(bytes, offset) {
  if (offset + 4 > bytes.length) return "";
  return TEXT.decode(bytes.subarray(offset, offset + 4));
}

export function readBoxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let offset = start;

  while (offset + 8 <= end) {
    const size32 = u32(view, offset);
    const type = fourcc(bytes, offset + 4);
    let header = 8;
    let size = size32;

    if (size32 === 1) {
      if (offset + 16 > end) break;
      const hi = u32(view, offset + 8);
      const lo = u32(view, offset + 12);
      size = hi * 0x100000000 + lo;
      header = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }

    if (size < header || offset + size > end) break;
    boxes.push({ type, start: offset, size, header });
    offset += size;
  }

  return boxes;
}

export function childBoxes(bytes, box) {
  return readBoxes(bytes, box.start + box.header, box.start + box.size);
}

export function findBox(bytes, parent, type) {
  return childBoxes(bytes, parent).find((box) => box.type === type) ?? null;
}

function mediaTimescale(bytes, mdhd) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = mdhd.start + mdhd.header;
  const version = bytes[base];
  return version === 1 ? u32(view, base + 20) : u32(view, base + 12);
}

function movieDuration(bytes, mvhd) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = mvhd.start + mvhd.header;
  const version = bytes[base];

  if (version === 1) {
    const scale = u32(view, base + 20);
    const hi = u32(view, base + 24);
    const lo = u32(view, base + 28);
    return scale ? (hi * 0x100000000 + lo) / scale : null;
  }

  const scale = u32(view, base + 12);
  const duration = u32(view, base + 16);
  return scale ? duration / scale : null;
}

function trackHandler(bytes, hdlr) {
  return fourcc(bytes, hdlr.start + hdlr.header + 8);
}

function sampleEntry(bytes, stsd) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = stsd.start + stsd.header;
  const count = u32(view, base + 4);
  if (!count) return null;

  const entry = base + 8;
  return {
    type: fourcc(bytes, entry + 4),
    width: u16(view, entry + 32),
    height: u16(view, entry + 34)
  };
}

function fpsFromStts(bytes, stts, timescale) {
  if (!timescale) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = stts.start + stts.header;
  const count = Math.min(u32(view, base + 4), 2048);

  let samples = 0;
  let duration = 0;

  for (let i = 0; i < count; i++) {
    const entry = base + 8 + i * 8;
    const sampleCount = u32(view, entry);
    const delta = u32(view, entry + 4);
    samples += sampleCount;
    duration += sampleCount * delta;
  }

  if (!samples || !duration) return null;
  return timescale * samples / duration;
}

function codecName(type) {
  const codecs = {
    avc1: "H.264",
    avc3: "H.264",
    hvc1: "H.265",
    hev1: "H.265",
    av01: "AV1",
    vp09: "VP9",
    vp08: "VP8"
  };
  return codecs[type] ?? type || "Unknown";
}

export function inspectMp4(bytes) {
  const top = readBoxes(bytes);
  const moov = top.find((box) => box.type === "moov");

  if (!moov) {
    throw new Error("This file does not contain a readable moov atom.");
  }

  const result = {
    container: "MP4",
    duration: null,
    width: null,
    height: null,
    fps: null,
    codec: null,
    moovAt: moov.start
  };

  const mvhd = findBox(bytes, moov, "mvhd");
  if (mvhd) result.duration = movieDuration(bytes, mvhd);

  for (const trak of childBoxes(bytes, moov).filter((b) => b.type === "trak")) {
    const mdia = findBox(bytes, trak, "mdia");
    if (!mdia) continue;

    const hdlr = findBox(bytes, mdia, "hdlr");
    if (hdlr && trackHandler(bytes, hdlr) !== "vide") continue;

    const mdhd = findBox(bytes, mdia, "mdhd");
    const minf = findBox(bytes, mdia, "minf");
    if (!minf) continue;

    const stbl = findBox(bytes, minf, "stbl");
    if (!stbl) continue;

    const stsd = findBox(bytes, stbl, "stsd");
    const stts = findBox(bytes, stbl, "stts");

    if (stsd) {
      const entry = sampleEntry(bytes, stsd);
      if (entry) {
        result.width = entry.width || null;
        result.height = entry.height || null;
        result.codec = codecName(entry.type);
      }
    }

    if (mdhd && stts) {
      result.fps = fpsFromStts(bytes, stts, mediaTimescale(bytes, mdhd));
    }

    if (result.codec) break;
  }

  return result;
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function moveMoovToFront(bytes) {
  const boxes = readBoxes(bytes);
  const moov = boxes.find((box) => box.type === "moov");

  if (!moov || moov.start === boxes[0]?.start) {
    return { bytes, changed: false, reason: "moov already at front or unavailable" };
  }

  // Moving moov without rewriting chunk offsets is unsafe when mdat precedes it.
  // This clean implementation therefore refuses to make a destructive guess.
  // The original media bytes remain untouched unless the container is already
  // fast-start compatible.
  const ftyp = boxes.find((box) => box.type === "ftyp");
  const mdat = boxes.find((box) => box.type === "mdat");

  if (!ftyp || !mdat) {
    return { bytes, changed: false, reason: "required top-level boxes were not found" };
  }

  return {
    bytes,
    changed: false,
    reason: "safe mode: sample offsets were not rewritten"
  };
}
