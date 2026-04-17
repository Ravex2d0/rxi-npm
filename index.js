const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function inflateData(uint8) {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(uint8);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function str(b, o, l) {
  return String.fromCharCode(...b.slice(o, o + l));
}

function reconstructFilter(filtered, filterType, width, ch) {
  const out = new Uint8Array(filtered.length);
  const rowBytes = width * ch;

  for (let i = 0; i < filtered.length; i++) {
    const x    = i % rowBytes;
    const left = x >= ch       ? out[i - ch]       : 0;
    const up   = i >= rowBytes ? out[i - rowBytes]  : 0;

    if      (filterType === 0) out[i] = filtered[i];
    else if (filterType === 1) out[i] = (filtered[i] + left) & 0xFF;
    else if (filterType === 2) out[i] = (filtered[i] + up)   & 0xFF;
  }
  return out;
}

function readMeta_V1(byte, pointer) {
  let comment = null, date = null;

  if (str(byte, pointer, 4) === "FINF") {
    pointer += 4;
    const len = byte[pointer++];
    comment = new TextDecoder().decode(byte.slice(pointer, pointer + len));
    pointer  += len;
    const day = byte[pointer++];
    const month = byte[pointer++];
    const year = (byte[pointer++] << 8) | byte[pointer++];
    date = new Date(year, month - 1, day);
  }
  return { pointer, meta: { comment, date } };
}

function readMeta_V2(byte, pointer) {
  let comment = null, date = null;

  if (str(byte, pointer, 4) === "META") {
    pointer += 4;
    const len = byte[pointer++];
    comment = new TextDecoder().decode(byte.slice(pointer, pointer + len));
    pointer  += len;
    const day = byte[pointer++];
    const month = byte[pointer++];
    const year = (byte[pointer++] << 8) | byte[pointer++];
    date = new Date(year, month - 1, day);
  }
  return { pointer, meta: { comment, date } };
}

function readVersion(byte, pointer) {
  if (byte[pointer] === 0xE2 && byte[pointer + 1] === 0x88 && byte[pointer + 2] === 0x9E) {
    return { major: 1, minor: 0, patch: 0, isLegacy: true };
  }
  return {
    major:    byte[pointer],
    minor:    byte[pointer + 1],
    patch:    byte[pointer + 2],
    isLegacy: false,
  };
}

function readFixedHeader(bytes) {
  const payload = bytes.slice(0, bytes.length - 4);
  const storedCRC =
    ((bytes[bytes.length - 4] << 24) |
     (bytes[bytes.length - 3] << 16) |
     (bytes[bytes.length - 2] <<  8) |
      bytes[bytes.length - 1]) >>> 0;

  if (crc32(payload) !== storedCRC) {
    throw new Error(
      `RXI: File corrupted! (CRC mismatch)\n` +
      `Expected: 0x${storedCRC.toString(16).toUpperCase().padStart(8, "0")}\n` +
      `Got:      0x${crc32(payload).toString(16).toUpperCase().padStart(8, "0")}`
    );
  }
  let pointer = 0;
  if (payload[pointer++] !== 0x02 || payload[pointer++] !== 0xD0) {
    throw new Error("RXI: Invalid SOF");
  }
  if (str(payload, pointer, 3) !== "RXI") {
    throw new Error("RXI: Invalid RXI marker");
  }
  pointer += 3;
  const version = readVersion(payload, pointer);
  pointer += 3;

  return { payload, pointer, version };
}

async function fetchBytes(src) {
  const response = await fetch(src);
  const buffer   = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function renderPixels(pdat, mode, scanMode, imgWidth, imgHeight, version) {
  const total = imgWidth * imgHeight;
  const canvas = new OffscreenCanvas(imgWidth, imgHeight);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(imgWidth, imgHeight);

  image.data.fill(0);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;

  let pd = pdat, pdp = 0;

  if (version.major === 1) {
    if (scanMode === 1) {
      for (let px = 0; px < total; px++) {
        let r = 0, g = 0, b = 0, a = 255;
        if (mode === 1) {
          r = g = b = pd[pdp++];
        } else if (mode === 2) {
          r = pd[pdp++];
          g = pd[pdp++];
          b = pd[pdp++];
        } else if (mode === 3) {
          r = pd[pdp++];
          g = pd[pdp++];
          b = pd[pdp++];
          a = pd[pdp++];
        } else if (mode === 4) {
          r = g = b = pd[pdp++];
          a = pd[pdp++];
        }
        image.data.set([r, g, b, a], px * 4);
      }

    } else if (scanMode === 2) {
      let px = 0;
      while (pdp < pd.length && px < total) {
        let r = 0, g = 0, b = 0, a = 255;
        if (mode === 1) {
          r = g = b = pd[pdp++];
        } else if (mode === 2) {
          r = pd[pdp++];
          g = pd[pdp++];
          b = pd[pdp++];
        } else if (mode === 3) {
          r = pd[pdp++];
          g = pd[pdp++];
          b = pd[pdp++];
          a = pd[pdp++];
        } else if (mode === 4) {
          r = g = b = pd[pdp++];
          a = pd[pdp++];
        }
        if (pdp + 1 >= pd.length) break;
        const byte1  = pd[pdp++];
        const byte2  = pd[pdp++];
        const isFill = (byte1 & 0x80) !== 0;
        const count  = ((byte1 & 0x7F) << 8) | byte2;

        if (isFill) {
          for (let i = 0; i < count && px < total; i++, px++)
            image.data.set([r, g, b, a], px * 4);
        } else {
          px += count;
        }
      }
    } else {
      throw new Error("RXI: Unknown scan mode");
    }
  } else if (version.major === 2) {
    const chPerPx = mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2;

    if (scanMode === 1) {
      const filterType = pd[pdp++];
      const rawBytes = pd.slice(pdp, pdp + total * chPerPx);
      const pixels = reconstructFilter(rawBytes, filterType, imgWidth, chPerPx);

      for (let px = 0; px < total; px++) {
        const base = px * chPerPx;
        let r = 0, g = 0, b = 0, a = 255;
        if (mode === 1) {
          r = g = b = pixels[base];
        } else if (mode === 2) {
          r = pixels[base];
          g = pixels[base + 1];
          b = pixels[base + 2];
        } else if (mode === 3) {
          r = pixels[base];
          g = pixels[base + 1];
          b = pixels[base + 2];
          a = pixels[base + 3];
        } else if (mode === 4) {
          r = g = b = pixels[base];
          a = pixels[base + 1];
        }
        image.data.set([r, g, b, a], px * 4);
      }
    } else if (scanMode === 2) {
      let px = 0;
      while (pdp < pd.length && px < total) {
        let r = 0, g = 0, b = 0, a = 255;

        if (mode === 1) {
          r = g = b = pd[pdp++];
        } else if (mode === 2) {
          r = pd[pdp++];
          g = pd[pdp++];
          b = pd[pdp++];
        } else if (mode === 3) {
          r = pd[pdp++];
          g = pd[pdp++];
          b = pd[pdp++];
          a = pd[pdp++];
        } else if (mode === 4) {
          r = g = b = pd[pdp++];
          a = pd[pdp++];
        }
        if (pdp >= pd.length) break;
        const seg    = pd[pdp++];
        const isFill = (seg & 0x80) !== 0;
        const count  = seg & 0x7F;

        if (isFill) {
          for (let i = 0; i < count && px < total; i++, px++)
            image.data.set([r, g, b, a], px * 4);
        } else {
          px += count;
        }
      }
    } else {
      throw new Error("RXI: Unknown scan mode");
    }
  } else {
    throw new Error(`RXI: Unsupported major version: ${version.major}`);
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, imgWidth, imgHeight };
}

const RXI = {
  use: async function ({ src, target, width = null, height = null }) {
    const bytes = await fetchBytes(src);
    if (bytes.length < 4) throw new Error("RXI: File too small");
    const { payload, pointer: ptr0, version } = readFixedHeader(bytes);
    let pointer = ptr0;
    let meta;

    if (version.major === 1) {
      ({ pointer, meta } = readMeta_V1(payload, pointer));
    } else if (version.major === 2) {
      ({ pointer, meta } = readMeta_V2(payload, pointer));
    } else {
      throw new Error(`RXI: Unsupported major version: ${version.major}`);
    }
    if (str(payload, pointer, 3) !== "HDR") throw new Error("RXI: HDR missing");
    pointer += 3;

    const mode = payload[pointer++];
    const imgWidth = (payload[pointer++] << 8) | payload[pointer++];
    const imgHeight = (payload[pointer++] << 8) | payload[pointer++];
    const scanMode = payload[pointer++];

    if (str(payload, pointer, 4) !== "PDAT") throw new Error("RXI: PDAT missing");
    pointer += 4;

    const compressed = payload[pointer++];
    const dataLength =
      (payload[pointer++] * 16777216) +
      (payload[pointer++] << 16)      +
      (payload[pointer++] << 8)       +
       payload[pointer++];

    if (pointer + dataLength > payload.length) throw new Error("RXI: PDAT corrupt");

    let pdat = payload.slice(pointer, pointer + dataLength);
    if (compressed === 1) pdat = await inflateData(pdat);

    const { canvas, imgWidth: w, imgHeight: h } =
      await renderPixels(pdat, mode, scanMode, imgWidth, imgHeight, version);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const url = URL.createObjectURL(blob);

    if (target.src?.startsWith("blob:")) URL.revokeObjectURL(target.src);
    target.src = url;

    if (width != null && height == null) {
      target.width = width;
      target.height = Math.round(width * (h / w));
    } else if (height != null && width == null) {
      target.height = height;
      target.width = Math.round(height * (w / h));
    } else {
      if (width  != null) target.width = width;
      if (height != null) target.height = height;
    }

    return { width: w, height: h };
  },
  info: async function (src) {
    const bytes = await fetchBytes(src);
    if (bytes.length < 4) throw new Error("RXI: File too small");
    const { payload, pointer: ptr0, version } = readFixedHeader(bytes);
    let pointer = ptr0;
    let meta;

    if (version.major === 1) {
      ({ pointer, meta } = readMeta_V1(payload, pointer));
    } else if (version.major === 2) {
      ({ pointer, meta } = readMeta_V2(payload, pointer));
    } else {
      throw new Error(`RXI: Unsupported major version: ${version.major}`);
    }

    if (str(payload, pointer, 3) !== "HDR") throw new Error("RXI: HDR missing");
    pointer += 3;

    const mode = payload[pointer++];
    const imgWidth = (payload[pointer++] << 8) | payload[pointer++];
    const imgHeight = (payload[pointer++] << 8) | payload[pointer++];
    const scanMode = payload[pointer++];

    return {
      version:  `${version.major}.${version.minor}.${version.patch}${version.isLegacy ? " (legacy)" : ""}`,
      width:    imgWidth,
      height:   imgHeight,
      mode:     mode,
      scanMode: scanMode,
      comment:  meta.comment,
      date:     meta.date,
    };
  },
};

export default RXI;
