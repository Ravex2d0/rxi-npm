# RXI
A lightweight JavaScript library for decoding `.rxi` image files with optional resizing and metadata reading.

---

## Installation
```bash
npm install rxi                          ```

---

## Usage
### Basic decoding
```JavaScript
import RXI from './node_modules/@ravex2d0/rxi/index.js';

const img = document.querySelector('img');

await RXI.use({
  src: 'example.rxi',
  target: img,
  width: 720 // optional, scales height automatically if not specified
  height: 720 // optional, scales width automatically if not specified
});
```
The image will be rendered on the <img> element with proper decoding from .rxi format.

### Access image metadata
```JavaScript
import RXI from './node_modules/@ravex2d0/rxi/index.js';

const info = await RXI.info('example.rxi');

console.log(info);
```
Output example:
```
{
  "width": 1280,
  "height": 1280,
  "mode": 2,
  "scanMode": 2,
  "comment": "Some comment",
  "date": "2026-04-08T00:00:00.000Z"
}
```
width / height: original dimensions of the image

mode / color mode:
1: grayscale
2: RGB
3: RGBA
4: grayscale + alpha

scanMode / scan mode of the pixel data:
1: raw pixel data
2: RLE

comment: optional comment embedded in .rxi file
date: optional timestamp embedded in .rxi

---

## Features
- Supports .rxi decoding with scanMode 1 (linear) and scanMode 2 (RLE-style fill/skip)
- Automatic width/height scaling while preserving aspect ratio
- Metadata reading (width, height, mode, scanMode, comment, date)
- CRC32 verification to ensure file integrity

---

## Notes
Throws an error if the file is corrupted (CRC mismatch) or if the header is invalid.

The library uses OffscreenCanvas, so it works in browsers that support it.

RXI.use() returns an object { width, height } representing the original image dimensions.

You can convert other image files to .rxi format at https://ravex2d0.github.io/rxi⁠.

---

## License
MIT
