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

const RXI = {
  use: async function({ src, target, width = null, height = null }) {
    const response = await fetch(src);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (bytes.length < 4) throw new Error("RXI: File too small");

    const payload = bytes.slice(0, bytes.length - 4);
    const storedCRC =
      ((bytes[bytes.length - 4] << 24) |
       (bytes[bytes.length - 3] << 16) |
       (bytes[bytes.length - 2] << 8)  |
        bytes[bytes.length - 1]) >>> 0;

    const computedCRC = crc32(payload);
    if (computedCRC !== storedCRC) {
      throw new Error(
        `RXI: File corrupted! (CRC mismatch)\nExpected: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")}\nGot:      0x${computedCRC.toString(16).toUpperCase().padStart(8,"0")}`
      );
    }

    let byte = payload, pointer = 0;

    if (byte[pointer++] !== 0x02 || byte[pointer++] !== 0xD0) {
      throw new Error("RXI: Invalid SOF");
    }

    pointer += 3;
    pointer += 3;

    if (String.fromCharCode(...byte.slice(pointer, pointer + 4)) === "FINF") {
      pointer += 4;
      const len = byte[pointer++];
      pointer += len;
      pointer += 4;
    }

    pointer += 3;

    const mode      = byte[pointer++];
    const imgWidth  = (byte[pointer++] << 8) | byte[pointer++];
    const imgHeight = (byte[pointer++] << 8) | byte[pointer++];
    const scanMode  = byte[pointer++];

    pointer += 4;

    const compressed = byte[pointer++];
    const dataLength =
      (byte[pointer++] * 16777216) +
      (byte[pointer++] << 16) +
      (byte[pointer++] << 8) +
       byte[pointer++];

    if (pointer + dataLength > byte.length) {
      throw new Error("RXI: PDAT corrupt");
    }

    let pdat = byte.slice(pointer, pointer + dataLength);
    if (compressed === 1) pdat = await inflateData(pdat);

    const offscreen = new OffscreenCanvas(imgWidth, imgHeight);
    const ctx = offscreen.getContext("2d");

    const image = ctx.createImageData(imgWidth, imgHeight);
    image.data.fill(0);
    for (let i = 3; i < image.data.length; i += 4) {
      image.data[i] = 255;
    }

    let pixelData = pdat, index = 0;
    const total = imgWidth * imgHeight;

    if (scanMode === 1) {
      for (let px = 0; px < total; px++) {
        let r = 0, g = 0, b = 0, a = 255;

        if (mode === 1) {
          r = g = b = pixelData[index++];
        } else if (mode === 2) {
          r = pixelData[index++];
          g = pixelData[index++];
          b = pixelData[index++];
        } else if (mode === 3) {
          r = pixelData[index++];
          g = pixelData[index++];
          b = pixelData[index++];
          a = pixelData[index++];
        } else if (mode === 4) {
          r = g = b = pixelData[index++];
          a = pixelData[index++];
        }

        image.data.set([r, g, b, a], px * 4);
      }
    } else if (scanMode === 2) {
      let px = 0;

      while (index < pixelData.length && px < total) {
        let r = 0, g = 0, b = 0, a = 255;

        if (mode === 1) {
          r = g = b = pixelData[index++];
        } else if (mode === 2) {
          r = pixelData[index++];
          g = pixelData[index++];
          b = pixelData[index++];
        } else if (mode === 3) {
          r = pixelData[index++];
          g = pixelData[index++];
          b = pixelData[index++];
          a = pixelData[index++];
        } else if (mode === 4) {
          r = g = b = pixelData[index++];
          a = pixelData[index++];
        }

        if (index + 1 >= pixelData.length) break;

        const byte1  = pixelData[index++];
        const byte2  = pixelData[index++];

        const isFill = (byte1 & 0x80) !== 0;
        const count  = ((byte1 & 0x7F) << 8) | byte2;

        if (isFill) {
          for (let i = 0; i < count && px < total; i++, px++) {
            image.data.set([r, g, b, a], px * 4);
          }
        } else {
          px += count;
        }
      }
    } else {
      throw new Error("RXI: Unknown scan mode");
    }

    ctx.putImageData(image, 0, 0);

    const blob = await offscreen.convertToBlob({ type: "image/png" });
    const url = URL.createObjectURL(blob);

    if (target.src?.startsWith("blob:")) {
      URL.revokeObjectURL(target.src);
    }

    target.src = url;

    if (width != null && height == null) {
      target.width  = width;
      target.height = Math.round(width * (imgHeight / imgWidth));
    } else if (height != null && width == null) {
      target.height = height;
      target.width  = Math.round(height * (imgWidth / imgHeight));
    } else {
      if (width  != null) target.width  = width;
      if (height != null) target.height = height;
    }

    return { width: imgWidth, height: imgHeight };
  },
  info: async function(src) {
    const response = await fetch(src);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (bytes.length < 4) throw new Error("RXI: File too small");

    const payload = bytes.slice(0, bytes.length - 4);
    const storedCRC =
      ((bytes[bytes.length - 4] << 24) |
      (bytes[bytes.length - 3] << 16) |
      (bytes[bytes.length - 2] << 8)  |
      bytes[bytes.length - 1]) >>> 0;

    const computedCRC = crc32(payload);
    if (computedCRC !== storedCRC) {
      throw new Error(
        `RXI: File corrupted! (CRC mismatch)\nExpected: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")}\nGot:      0x${computedCRC.toString(16).toUpperCase().padStart(8,"0")}`
      );
    }

    let byte = payload, pointer = 0;

    if (byte[pointer++] !== 0x02 || byte[pointer++] !== 0xD0) {
      throw new Error("RXI: Invalid SOF");
    }

    pointer += 3;
    pointer += 3;

    let comment = null;
    let date = null;

    if (String.fromCharCode(...byte.slice(pointer, pointer + 4)) === "FINF") {
      pointer += 4;

      const commentLength = byte[pointer++];
      const commentBytes = byte.slice(pointer, pointer + commentLength);
      comment = new TextDecoder().decode(commentBytes);
      pointer += commentLength;

      const day = byte[pointer++];
      const month = byte[pointer++];
      const year = (byte[pointer++] << 8) | byte[pointer++];

      date = new Date(year, month - 1, day);
    }

    pointer += 3;

    const mode      = byte[pointer++];
    const imgWidth  = (byte[pointer++] << 8) | byte[pointer++];
    const imgHeight = (byte[pointer++] << 8) | byte[pointer++];
    const scanMode  = byte[pointer++];

    return {
      width:    imgWidth,
      height:   imgHeight,
      mode:     mode,
      scanMode: scanMode,
      comment:  comment,
      date:     date,
    };
  }
}

export default RXI;
