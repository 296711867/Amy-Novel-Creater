import type { NovelProjectBundle } from "./project-export";
import { safeExportName } from "./project-export";

export interface TextArchiveEntry {
  name: string;
  content: string;
}

export function buildTextArchiveEntries(
  bundle: NovelProjectBundle,
): TextArchiveEntry[] {
  const root = safeExportName(bundle.novel.title);
  const info = [
    `书名：${bundle.novel.title}`,
    `题材：${bundle.novel.genre || "未分类"}`,
    `简介：${bundle.novel.premise || "未填写"}`,
    `目标：${bundle.novel.targetChapters} 章，每章约 ${bundle.novel.chapterWords} 字`,
  ].join("\r\n");
  const settings = [
    "【作品设定】",
    ...bundle.bible.map((item) => `\r\n【${item.kind}】\r\n${item.content}`),
    "\r\n【人物与实体】",
    ...bundle.entities.map(
      (item) => `${item.name}（${item.type}）：${item.summary || "未填写"}`,
    ),
    "\r\n【分卷】",
    ...bundle.volumes.map(
      (item) => `${item.title}：${item.outline || "未填写"}`,
    ),
  ].join("\r\n");
  const accepted = [...bundle.chapters]
    .filter((item) => item.status === "accepted" && item.content.trim())
    .sort((a, b) => a.position - b.position);
  const width = Math.max(2, String(bundle.novel.targetChapters).length);
  return [
    { name: `${root}/00-作品信息.txt`, content: info },
    { name: `${root}/01-作品设定.txt`, content: settings },
    ...accepted.map((item) => ({
      name: `${root}/章节/${String(item.position).padStart(width, "0")}-${safeExportName(item.title)}.txt`,
      content: `${item.title}\r\n\r\n${item.content.trim()}\r\n`,
    })),
  ];
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** 标准 ZIP Store（不二次压缩正文），无需运行时依赖，Windows 可直接解压。 */
export function encodeTextZip(entries: TextArchiveEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const write = (size: number, fill: (view: DataView) => void) => {
    const bytes = new Uint8Array(size);
    fill(new DataView(bytes.buffer));
    return bytes;
  };
  for (const entry of entries) {
    const name = encoder.encode(entry.name), data = encoder.encode(entry.content);
    const crc = crc32(data);
    const header = write(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(12, 0x21, true); // DOS date: 1980-01-01
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
    });
    local.push(header, name, data);
    const directory = write(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(14, 0x21, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, data.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
    });
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralBytes = concat(central);
  const end = write(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true);
    view.setUint32(12, centralBytes.length, true);
    view.setUint32(16, offset, true);
  });
  return concat([...local, centralBytes, end]);
}
