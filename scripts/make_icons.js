const fs = require("fs");
const zlib = require("zlib");
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  const both = Buffer.concat([t, data]);
  crc.writeUInt32BE(crc32(both));
  return Buffer.concat([len, both, crc]);
}
function png(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * 3;
      raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2];
    }
  }
  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}
const c = [15, 61, 62];
fs.mkdirSync("E:/Codes/DRO/apps/web/public/icons", { recursive: true });
fs.writeFileSync("E:/Codes/DRO/apps/web/public/icons/icon-192.png", png(192, 192, c));
fs.writeFileSync("E:/Codes/DRO/apps/web/public/icons/icon-512.png", png(512, 512, c));
console.log("icons ok");
