function crc32(bytes: Uint8Array, initial = 0xffffffff) {
  let crc = initial;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}
async function fileCrc(data: Uint8Array | Blob) {
  if (data instanceof Uint8Array) return (crc32(data) ^ 0xffffffff) >>> 0;
  let crc = 0xffffffff;
  for (let offset = 0; offset < data.size; offset += 1024 * 1024) {
    crc = crc32(
      new Uint8Array(
        await data.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      ),
      crc,
    );
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function zipFiles(
  files: Array<{ name: string; data: string | Blob }>,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data =
      typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const size = data instanceof Blob ? data.size : data.length;
    if (size > 0xffffffff) throw new Error("A file exceeds the ZIP size limit");
    const crc = await fileCrc(data);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local as BlobPart, data as BlobPart);
    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, size, true);
    d.setUint32(24, size, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir as BlobPart);
    offset += local.length + size;
  }
  const centralSize = central.reduce(
    (sum, part) => sum + (part as Uint8Array).length,
    0,
  );
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
export { reportHtml } from "./report-html";
