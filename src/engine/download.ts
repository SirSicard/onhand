import { Zip, ZipPassThrough } from "fflate";

/**
 * Getting finished files out of the browser.
 *
 * Two paths, and the difference matters for large batches:
 *
 *   - File System Access API (Chromium): the user picks a destination once and
 *     bytes stream straight to disk. Nothing large is ever held in memory.
 *   - Everywhere else: a blob URL and a synthetic click. The blob has to exist
 *     in full before the download starts — that is how the API works — but
 *     building it from chunks lets the browser move the data out of the JS heap
 *     rather than holding one enormous contiguous buffer.
 *
 * The blob URL is revoked either way. A converter that leaks one per download
 * pins every output in memory for the life of the tab, which on a 50-file video
 * batch is the difference between working and not.
 */

interface FilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type SaveFilePicker = (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;

function filePicker(): SaveFilePicker | null {
  const fn = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  // Feature-detected, never UA-sniffed. Also absent in cross-origin iframes
  // even on browsers that implement it, so the check has to be the function.
  return typeof fn === "function" ? fn : null;
}

/** True when we can stream to disk rather than materialising a blob. */
export function canStreamToDisk(): boolean {
  return filePicker() !== null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

/**
 * Trigger a download of a single blob.
 *
 * Returns false when the user cancelled the file picker — which is not an
 * error, and must not be reported as one.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  const pick = filePicker();
  if (pick) {
    let handle: FileSystemFileHandle;
    try {
      handle = await pick({
        suggestedName: filename,
        types: [
          {
            description: "Converted file",
            accept: { [blob.type || "application/octet-stream"]: [extensionOf(filename)] },
          },
        ],
      });
    } catch (err) {
      // AbortError means they closed the dialog. Anything else means the API
      // is present but unusable here, so fall through to the link approach
      // rather than leaving them with no way to get the file.
      if ((err as DOMException)?.name === "AbortError") return false;
      return linkDownload(blob, filename);
    }
    const writable = await handle.createWritable();
    await blob.stream().pipeTo(writable);
    return true;
  }
  return linkDownload(blob, filename);
}

function linkDownload(blob: Blob, filename: string): boolean {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next task, not immediately: revoking synchronously races the
  // browser's own read of the URL and cancels the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export interface ZipEntry {
  filename: string;
  blob: Blob;
}

/**
 * Zip a set of outputs and save it, streaming throughout.
 *
 * Entries are STORED, not deflated. Everything this app produces is already
 * compressed — JPEG, MP4, MP3 — so deflating it burns CPU proportional to the
 * batch size to save approximately nothing. On a 20-file video batch that is
 * the difference between instant and a visible stall.
 */
export async function saveZip(
  entries: ZipEntry[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<boolean> {
  if (entries.length === 0) return false;

  const pick = filePicker();
  let writable: FileSystemWritableFileStream | null = null;

  if (pick) {
    try {
      const handle = await pick({
        suggestedName: zipName,
        types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return false;
      writable = null; // fall back to the buffered path
    }
  }

  // Without a disk stream we accumulate chunks and hand them to Blob at the
  // end. Blob can spill to disk; a single concatenated Uint8Array cannot.
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  const failure = await new Promise<Error | null>((resolve) => {
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      resolve(err);
    };

    const pending: Promise<unknown>[] = [];

    const zip = new Zip((err, chunk, final) => {
      if (err) return finish(err);
      if (writable) {
        // Queue the write; fflate's callback is synchronous and cannot await.
        pending.push(writable.write(chunk));
      } else {
        // Copy out of fflate's buffer: it reuses the backing store.
        chunks.push(new Uint8Array(chunk));
      }
      if (final) {
        Promise.all(pending).then(
          () => finish(null),
          (e) => finish(e as Error),
        );
      }
    });

    void (async () => {
      try {
        const seen = new Set<string>();
        for (const [index, entry] of entries.entries()) {
          // Two outputs can genuinely share a name — photo.png and photo.jpg
          // both become photo.webp. Zip permits duplicates; every extractor
          // handles them differently, and some silently keep only one.
          let name = entry.filename;
          for (let n = 2; seen.has(name); n++) {
            const dot = entry.filename.lastIndexOf(".");
            const stem = dot > 0 ? entry.filename.slice(0, dot) : entry.filename;
            const ext = dot > 0 ? entry.filename.slice(dot) : "";
            name = `${stem} (${n})${ext}`;
          }
          seen.add(name);

          const file = new ZipPassThrough(name);
          zip.add(file);

          // Read each blob as a stream so a 2 GB output never lands in memory
          // whole just to be copied into the archive.
          const reader = entry.blob.stream().getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            file.push(value);
          }
          file.push(new Uint8Array(0), true);
          onProgress?.(index + 1, entries.length);
        }
        zip.end();
      } catch (err) {
        finish(err as Error);
      }
    })();
  });

  if (failure) {
    await writable?.abort().catch(() => {});
    throw failure;
  }

  if (writable) {
    await writable.close();
    return true;
  }
  return linkDownload(new Blob(chunks, { type: "application/zip" }), zipName);
}
