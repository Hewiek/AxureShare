/* 零依赖 ZIP 打包：CRC32 + deflate-raw（CompressionStream），不可用时回退为 store。 */
(function (global) {
  "use strict";

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosStamp(date) {
    var d = date || new Date();
    var year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff,
      date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
    };
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(text);
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") return null;
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      var buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function localHeader(entry) {
    var bytes = new Uint8Array(30 + entry.nameBytes.length);
    var view = new DataView(bytes.buffer);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 0x0800);
    writeU16(view, 8, entry.method);
    writeU16(view, 10, entry.stamp.time);
    writeU16(view, 12, entry.stamp.date);
    writeU32(view, 14, entry.crc);
    writeU32(view, 18, entry.compressed.length);
    writeU32(view, 22, entry.uncompressedSize);
    writeU16(view, 26, entry.nameBytes.length);
    writeU16(view, 28, 0);
    bytes.set(entry.nameBytes, 30);
    return bytes;
  }

  function centralHeader(entry, offset) {
    var bytes = new Uint8Array(46 + entry.nameBytes.length);
    var view = new DataView(bytes.buffer);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 20);
    writeU16(view, 8, 0x0800);
    writeU16(view, 10, entry.method);
    writeU16(view, 12, entry.stamp.time);
    writeU16(view, 14, entry.stamp.date);
    writeU32(view, 16, entry.crc);
    writeU32(view, 20, entry.compressed.length);
    writeU32(view, 24, entry.uncompressedSize);
    writeU16(view, 28, entry.nameBytes.length);
    writeU32(view, 38, entry.externalAttrs);
    writeU32(view, 42, offset);
    bytes.set(entry.nameBytes, 46);
    return bytes;
  }

  function endOfCentralDirectory(entryCount, centralLen, centralOffset) {
    var bytes = new Uint8Array(22);
    var view = new DataView(bytes.buffer);
    writeU32(view, 0, 0x06054b50);
    writeU16(view, 8, entryCount);
    writeU16(view, 10, entryCount);
    writeU32(view, 12, centralLen);
    writeU32(view, 16, centralOffset);
    writeU16(view, 20, 0);
    return bytes;
  }

  /* entries: [{ name: string, data: Uint8Array|ArrayBuffer|Blob, time?: Date }]
     -> { chunks: Uint8Array[], size: number }；chunks 顺序拼接即为完整 ZIP。 */
  async function buildZip(entries, onEntry) {
    var totalUncompressed = 0;
    for (var i = 0; i < entries.length; i++) totalUncompressed += entries[i].data.byteLength || entries[i].data.size || 0;
    if (totalUncompressed > 0xffffffff) throw new Error("原型体积超过 4GB，ZIP32 不支持");

    var stamp = dosStamp();
    var prepared = [];
    var offset = 0;
    var chunks = [];
    var central = [];
    var centralLen = 0;

    for (var idx = 0; idx < entries.length; idx++) {
      var raw = entries[idx].data;
      if (raw instanceof Blob) raw = new Uint8Array(await raw.arrayBuffer());
      else if (raw instanceof ArrayBuffer) raw = new Uint8Array(raw);

      var name = String(entries[idx].name).replace(/\\/g, "/").replace(/^\/+/, "");
      if (!name) continue;

      var crc = crc32(raw);
      var deflated = await deflateRaw(raw);
      var useDeflate = !!deflated && deflated.length < raw.length;
      var entry = {
        nameBytes: utf8Bytes(name),
        method: useDeflate ? 8 : 0,
        crc: crc,
        uncompressedSize: raw.length,
        compressed: useDeflate ? deflated : raw,
        stamp: entries[idx].time ? dosStamp(entries[idx].time) : stamp,
        externalAttrs: /\/$/.test(name) ? 0x10 : 0,
        offset: offset,
      };

      var head = localHeader(entry);
      chunks.push(head, entry.compressed);
      offset += head.length + entry.compressed.length;
      prepared.push(entry);
      if (onEntry) onEntry(idx + 1, entries.length, name);
    }

    for (var c = 0; c < prepared.length; c++) {
      var cd = centralHeader(prepared[c], prepared[c].offset);
      central.push(cd);
      centralLen += cd.length;
    }

    var centralOffset = offset;
    for (var m = 0; m < central.length; m++) chunks.push(central[m]);
    var eocd = endOfCentralDirectory(prepared.length, centralLen, centralOffset);
    chunks.push(eocd);

    var size = 0;
    for (var s = 0; s < chunks.length; s++) size += chunks[s].length;
    return { chunks: chunks, size: size, entryCount: prepared.length };
  }

  /* 把 chunks 包成可读流，读取时回调已发送字节数。 */
  function chunkStream(chunks, onBytes) {
    var index = 0;
    var sent = 0;
    return new ReadableStream({
      pull: function (controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        var chunk = chunks[index++];
        sent += chunk.length;
        if (onBytes) onBytes(sent);
        controller.enqueue(chunk);
      },
    });
  }

  global.AXShare = global.AXShare || {};
  global.AXShare.zip = { buildZip: buildZip, chunkStream: chunkStream, crc32: crc32, deflateRaw: deflateRaw };
})(typeof self !== "undefined" ? self : globalThis);
