import { downloadZip } from "client-zip";
import { sortCameras } from "./keys";
import type { SignedFile } from "./types";

// Browser-side downloads. The robot uploads short chunks; here they are turned back
// into one file per stream, straight from presigned S3 URLs (no server work):
//   camera -> the .ts chunks joined byte-for-byte into one .ts (MPEG-TS concatenates cleanly)
//   imu    -> the .csv.gz chunks decompressed and joined into one .csv (one header row)
//   lidar  -> a ZIP of the .npz chunks (each is a self-contained numpy archive)
//   session-> a ZIP with <cam>.ts per camera, imu.csv, lidar/*.npz and session.json

export type Progress = (doneBytes: number, currentFile: string) => void;

export async function fetchFiles(apiBase: string, query: Record<string, string>, signal: AbortSignal) {
  const res = await fetch(`${apiBase}/files?${new URLSearchParams(query)}`, { signal });
  if (!res.ok) throw new Error(`File list failed (HTTP ${res.status})`);
  return ((await res.json()) as { files: SignedFile[] }).files;
}

const byStart = (a: SignedFile, b: SignedFile) => (a.start ?? 0) - (b.start ?? 0) || a.name.localeCompare(b.name);

/** Shared byte counter so several streams inside one ZIP report a single progress. */
export function counter(onProgress: Progress) {
  let done = 0;
  return (n: number, file: string) => {
    done += n;
    onProgress(done, file);
  };
}

/** One continuous .ts stream from a camera's chunks, fetched one after another. */
export function joinedVideo(
  files: SignedFile[],
  add: (n: number, file: string) => void,
  signal: AbortSignal,
  missing: string[],
): ReadableStream<Uint8Array> {
  const queue = [...files].sort(byStart);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let current: SignedFile | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      for (;;) {
        if (!reader) {
          current = queue.shift() ?? null;
          if (!current) return ctl.close();
          const res = await fetch(current.url, { signal });
          if (!res.ok || !res.body) {
            missing.push(`${current.name} (HTTP ${res.status})`);
            add(current.size, current.name);
            continue; // skip a missing chunk rather than fail the whole video
          }
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        add(value.byteLength, current!.name);
        ctl.enqueue(value);
        return;
      }
    },
    cancel() {
      reader?.cancel().catch(() => {});
    },
  });
}

const baseName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  // S3 may already have served it decoded (Content-Encoding: gzip); check the magic bytes
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** IMU chunks (.csv.gz) as one CSV, keeping only the first header row. */
export async function joinedImu(
  files: SignedFile[],
  add: (n: number, file: string) => void,
  signal: AbortSignal,
  missing: string[],
): Promise<Blob> {
  const parts: string[] = [];
  let header: string | null = null;
  const decoder = new TextDecoder();
  for (const f of [...files].sort(byStart)) {
    const res = await fetch(f.url, { signal });
    if (!res.ok) {
      missing.push(`${f.name} (HTTP ${res.status})`);
      add(f.size, f.name);
      continue;
    }
    const raw = new Uint8Array(await res.arrayBuffer());
    add(raw.byteLength, f.name);
    let text = decoder.decode(await gunzipIfNeeded(raw));
    if (!text) continue;
    const nl = text.indexOf("\n");
    const first = (nl < 0 ? text : text.slice(0, nl)).trim();
    if (first && Number.isNaN(Number(first.split(",")[0]))) {
      header ??= first;
      text = nl < 0 ? "" : text.slice(nl + 1);
    }
    if (text && !text.endsWith("\n")) text += "\n";
    parts.push(text);
  }
  return new Blob([header ? header + "\n" : "", ...parts], { type: "text/csv" });
}

/** ZIP entries for files kept as they are, fetched one after another. */
async function* rawEntries(
  files: SignedFile[],
  folder: string,
  add: (n: number, file: string) => void,
  signal: AbortSignal,
  missing: string[],
) {
  for (const f of [...files].sort(byStart)) {
    const res = await fetch(f.url, { signal });
    if (!res.ok) {
      missing.push(`${f.name} (HTTP ${res.status})`);
      add(f.size, f.name);
      continue;
    }
    const data = await res.blob();
    add(data.size, f.name);
    yield { name: `${folder}/${baseName(f.name)}`, input: data };
  }
}

/** LiDAR chunks (.npz) as one ZIP. */
export function lidarZip(
  files: SignedFile[],
  folder: string,
  add: (n: number, file: string) => void,
  signal: AbortSignal,
  missing: string[],
): ReadableStream<Uint8Array> {
  async function* entries() {
    yield* rawEntries(files, folder, add, signal, missing);
    if (missing.length) {
      yield { name: `${folder}/MISSING_FILES.txt`, input: `These chunks could not be downloaded:\n${missing.join("\n")}\n` };
    }
  }
  return downloadZip(entries()).body!;
}

type SaveTarget = { write(chunk: Uint8Array | Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type PickerWindow = {
  showSaveFilePicker?: (opts: unknown) => Promise<{ createWritable(): Promise<SaveTarget> }>;
};

/**
 * Ask where to save first (Chrome/Edge), so large files stream to disk instead of memory.
 * Returns null when the user cancels, or "memory" when the browser has no save picker.
 */
export async function pickSaveTarget(fileName: string): Promise<SaveTarget | "memory" | null> {
  const picker = (window as unknown as PickerWindow).showSaveFilePicker;
  if (!picker) return "memory";
  try {
    const ext = fileName.slice(fileName.lastIndexOf("."));
    const handle = await picker({ suggestedName: fileName, types: [{ description: ext, accept: { "application/octet-stream": [ext] } }] });
    return await handle.createWritable();
  } catch {
    return null;
  }
}

export async function save(target: SaveTarget | "memory", fileName: string, data: ReadableStream<Uint8Array> | Blob) {
  if (target === "memory") {
    const blob = data instanceof Blob ? data : await new Response(data).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  try {
    if (data instanceof Blob) {
      await target.write(data);
    } else {
      const reader = data.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await target.write(value);
      }
    }
    await target.close();
  } catch (e) {
    await target.abort().catch(() => {});
    throw e;
  }
}

/** The whole session as one ZIP: one video per camera, imu.csv, lidar/*.npz, session.json. */
export async function sessionZip(
  files: SignedFile[],
  folder: string,
  add: (n: number, file: string) => void,
  signal: AbortSignal,
  missing: string[],
): Promise<ReadableStream<Uint8Array>> {
  const cameras = sortCameras(new Set(files.flatMap((f) => (f.camera ? [f.camera] : []))));
  const imu = files.filter((f) => f.sensor === "imu");
  const lidar = files.filter((f) => f.sensor === "lidar");
  const meta = files.filter((f) => f.kind === "meta");

  async function* entries() {
    for (const cam of cameras) {
      yield {
        name: `${folder}/${cam}.ts`,
        input: joinedVideo(files.filter((f) => f.camera === cam), add, signal, missing),
      };
    }
    if (imu.length) {
      yield { name: `${folder}/imu.csv`, input: await joinedImu(imu, add, signal, missing) };
    }
    yield* rawEntries(lidar, `${folder}/lidar`, add, signal, missing);
    for (const f of meta) {
      const res = await fetch(f.url, { signal });
      if (res.ok) yield { name: `${folder}/${f.name}`, input: await res.blob() };
      add(f.size, f.name);
    }
    if (missing.length) {
      yield { name: `${folder}/MISSING_FILES.txt`, input: `These chunks could not be downloaded:\n${missing.join("\n")}\n` };
    }
  }
  return downloadZip(entries()).body!;
}
