/**
 * Minimal ZIP (store-only) builder. No compression, no third-party deps.
 */
(function (global) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }

  function u32(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }

  function strBytes(s) {
    return new TextEncoder().encode(s);
  }

  function concat(parts) {
    const len = parts.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  /**
   * @param {{name: string, data: Uint8Array}[]} files
   * @returns {Blob}
   */
  function buildZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of files) {
      const name = strBytes(file.name.replace(/\\/g, "/"));
      const data = file.data;
      const crc = crc32(data);
      const local = concat([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        name,
        data,
      ]);
      locals.push(local);

      const central = concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]);
      centrals.push(central);
      offset += local.length;
    }

    const centralDir = concat(centrals);
    const end = concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0),
    ]);

    return new Blob([concat([...locals, centralDir, end])], { type: "application/zip" });
  }

  global.PicVaultZip = { buildZip };
})(typeof globalThis !== "undefined" ? globalThis : window);
