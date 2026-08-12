import fs from "node:fs";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilterRow(type, row, previous, bytesPerPixel) {
  const output = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? output[i - bytesPerPixel] : 0;
    const up = previous?.[i] ?? 0;
    const upperLeft = i >= bytesPerPixel ? (previous?.[i - bytesPerPixel] ?? 0) : 0;
    const value = row[i];
    output[i] = (type === 0 ? value : type === 1 ? value + left : type === 2 ? value + up : type === 3 ? value + Math.floor((left + up) / 2) : value + paeth(left, up, upperLeft)) & 255;
  }
  return output;
}

export function readGrayPng(filePath) {
  const input = fs.readFileSync(filePath);
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`not a PNG: ${filePath}`);
  let offset = 8;
  let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
  const idat = [];
  while (offset < input.length) {
    const length = input.readUInt32BE(offset); offset += 4;
    const type = input.subarray(offset, offset + 4).toString("ascii"); offset += 4;
    const data = input.subarray(offset, offset + length); offset += length;
    offset += 4;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8 || ![0, 6].includes(colorType)) throw new Error(`unsupported PNG format ${bitDepth}/${colorType}`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const channels = colorType === 6 ? 4 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const mask = new Uint8Array(width * height);
  let cursor = 0; let previous = null;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    const row = unfilterRow(filter, raw.subarray(cursor, cursor + stride), previous, channels);
    cursor += stride;
    for (let x = 0; x < width; x += 1) mask[y * width + x] = row[x * channels] > 127 ? 1 : 0;
    previous = row;
  }
  return { width, height, mask };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.concat([name, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), 8 + data.length);
  return result;
}

export function writeGrayPng(filePath, mask, width, height) {
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = mask[y * width + x] ? 255 : 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
  fs.mkdirSync(new URL(".", `file://${filePath}`).pathname, { recursive: true });
  fs.writeFileSync(filePath, png);
}

export function writeComparisonPng(filePath, reference, generated, width, height) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = row + 1 + x * 3;
      const ref = reference[index] !== 0; const actual = generated[index] !== 0;
      raw[offset] = ref ? 255 : 0;
      raw[offset + 1] = actual ? 255 : 0;
      raw[offset + 2] = ref !== actual ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
  fs.mkdirSync(new URL(".", `file://${filePath}`).pathname, { recursive: true });
  fs.writeFileSync(filePath, png);
}
