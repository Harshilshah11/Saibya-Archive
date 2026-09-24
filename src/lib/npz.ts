// Minimal NumPy .npz / .npy reader and writer, enough to merge cloud_sync's per-minute LiDAR
// chunks into one file in the browser. An .npz is a ZIP of .npy files; np.savez_compressed
// deflates each entry (and numpy writes ZIP64 local headers), so entry sizes are taken from
// the central directory. Only little-endian numeric arrays in C order are supported, which
// is all cloud_sync writes: t <f8 [S], offsets <i8 [S+1], points <f4 [N,3].

export type Dtype = "<f8" | "<i8" | "<f4";

export interface NpyArray {
  dtype: Dtype;
  shape: number[];
  /** Raw little-endian bytes, C order */
  data: Uint8Array;
}

const ITEM: Record<Dtype, number> = { "<f8": 8, "<i8": 8, "<f4": 4 };

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function u64(b: Uint8Array, o: number) {
  return u32(b, o) + u32(b, o + 4) * 2 ** 32;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every array in an .npz, by name without the .npy suffix. */
export async function readNpz(zip: Uint8Array): Promise<Record<string, NpyArray>> {
  // End of central directory: signature 0x06054b50, searched from the end (comment ≤ 64 KiB)
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip/npz file");
  let count = u16(zip, eocd + 10);
  let cdOffset = u32(zip, eocd + 16);
  // ZIP64 end of central directory, when the 32-bit fields overflowed
  if ((cdOffset === 0xffffffff || count === 0xffff) && u32(zip, eocd - 20) === 0x07064b50) {
    const z64 = u64(zip, eocd - 20 + 8);
    count = u64(zip, z64 + 32);
    cdOffset = u64(zip, z64 + 48);
  }

  const out: Record<string, NpyArray> = {};
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (u32(zip, p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = u16(zip, p + 10);
    let csize = u32(zip, p + 20);
    let usize = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    let local = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extended info (id 0x0001): only the fields that overflowed are present, in this order
    for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; ) {
      const id = u16(zip, e);
      const size = u16(zip, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff) {
          usize = u64(zip, q);
          q += 8;
        }
        if (csize === 0xffffffff) {
          csize = u64(zip, q);
          q += 8;
        }
        if (local === 0xffffffff) local = u64(zip, q);
      }
      e += 4 + size;
    }
    p += 46 + nameLen + extraLen + commentLen;

    const dataStart = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    const raw = zip.subarray(dataStart, dataStart + csize);
    const bytes = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (!bytes) throw new Error(`${name}: unsupported zip compression ${method}`);
    if (bytes.length !== usize) throw new Error(`${name}: size mismatch`);
    out[name.replace(/\.npy$/, "")] = parseNpy(bytes, name);
  }
  return out;
}

function parseNpy(b: Uint8Array, name: string): NpyArray {
  if (b[0] !== 0x93 || new TextDecoder().decode(b.subarray(1, 6)) !== "NUMPY") throw new Error(`${name}: not .npy`);
  const major = b[6];
  const hlen = major === 1 ? u16(b, 8) : u32(b, 8);
  const hstart = major === 1 ? 10 : 12;
  const header = new TextDecoder("latin1").decode(b.subarray(hstart, hstart + hlen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1];
  const shapeText = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1];
  if (descr !== "<f8" && descr !== "<i8" && descr !== "<f4") throw new Error(`${name}: dtype ${descr} not supported`);
  if (fortran !== "False") throw new Error(`${name}: Fortran-order arrays not supported`);
  const shape = (shapeText ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const data = b.subarray(hstart + hlen);
  const expected = shape.reduce((a, x) => a * x, 1) * ITEM[descr];
  if (data.length !== expected) throw new Error(`${name}: expected ${expected} data bytes, got ${data.length}`);
  return { dtype: descr, shape, data };
}

/** One .npy file (format 1.0), header padded to a 64-byte boundary as numpy does. */
export function writeNpy(a: NpyArray): Uint8Array {
  const shape = a.shape.length === 1 ? `(${a.shape[0]},)` : `(${a.shape.join(", ")})`;
  let header = `{'descr': '${a.dtype}', 'fortran_order': False, 'shape': ${shape}, }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  header = header + " ".repeat(pad % 64) + "\n";
  const out = new Uint8Array(10 + header.length + a.data.length);
  out.set([0x93, ...new TextEncoder().encode("NUMPY"), 1, 0, header.length & 0xff, header.length >> 8]);
  out.set(new TextEncoder().encode(header), 10);
  out.set(a.data, 10 + header.length);
  return out;
}

/**
 * Merge cloud_sync LiDAR chunks (in time order) into one set of arrays:
 * t and points concatenated, offsets rebased so points[offsets[i]:offsets[i+1]] is still scan i.
 */
export function mergeLidar(chunks: Array<Record<string, NpyArray>>): Record<string, NpyArray> {
  const ts: Uint8Array[] = [];
  const pts: Uint8Array[] = [];
  const offsets: bigint[] = [0n];
  let base = 0n;
  let nPoints = 0;
  for (const c of chunks) {
    const { t, offsets: off, points } = c;
    if (!t || !off || !points) throw new Error("LiDAR chunk is missing t / offsets / points");
    if (t.dtype !== "<f8" || off.dtype !== "<i8" || points.dtype !== "<f4" || points.shape[1] !== 3) {
      throw new Error("LiDAR chunk has an unexpected layout");
    }
    const o = new BigInt64Array(off.data.slice().buffer);
    for (let i = 1; i < o.length; i++) offsets.push(base + o[i]);
    base += o[o.length - 1];
    nPoints += points.shape[0];
    ts.push(t.data);
    pts.push(points.data);
  }
  const concat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  return {
    t: { dtype: "<f8", shape: [offsets.length - 1], data: concat(ts) },
    offsets: { dtype: "<i8", shape: [offsets.length], data: new Uint8Array(BigInt64Array.from(offsets).buffer) },
    points: { dtype: "<f4", shape: [nPoints, 3], data: concat(pts) },
  };
}
