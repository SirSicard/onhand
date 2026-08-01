import * as Comlink from "comlink";
import { FORMATS, type FormatId } from "../formats";
import { ConversionError, type ConvertOptions, type Engine, type ProgressUpdate } from "../types";
import type { PdfWorkerApi } from "../workers/pdf.worker";
import { convertImageBuffer } from "./imageEngine";

/**
 * PDF engine, both directions.
 *
 *   PDF → image : render pages. A multi-page PDF yields one image per page,
 *                 zipped, because silently returning only page 1 is the kind of
 *                 data loss people don't notice until it matters.
 *   image → PDF : one image per page, page sized to the image.
 */

let handle: { worker: Worker; api: Comlink.Remote<PdfWorkerApi> } | null = null;

function getWorker() {
  if (!handle) {
    const worker = new Worker(new URL("../workers/pdf.worker.ts", import.meta.url), {
      type: "module",
      name: "onhand-pdf",
    });
    handle = { worker, api: Comlink.wrap<PdfWorkerApi>(worker) };
  }
  return handle;
}

export function resetPdfWorker(): void {
  handle?.worker.terminate();
  handle = null;
}

/** Formats pdf-lib can embed directly; everything else is transcoded to PNG first. */
const PDF_EMBEDDABLE: ReadonlySet<FormatId> = new Set(["jpeg", "png"]);

const IMAGE_INPUTS: ReadonlySet<FormatId> = new Set([
  "jpeg",
  "png",
  "webp",
  "avif",
  "heic",
  "gif",
  "bmp",
  "ico",
  "svg",
  "tiff",
]);

export const pdfEngine: Engine = {
  id: "pdf",
  cost: 2, // heavier than the image engine; only used when PDF is involved

  canHandle(source, target) {
    if (source === "pdf") return ["png", "jpeg", "webp", "avif"].includes(target);
    if (target === "pdf") return IMAGE_INPUTS.has(source);
    return false;
  },

  async convert(
    file: File,
    source: FormatId,
    target: FormatId,
    options: ConvertOptions,
    onProgress: (u: ProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; filename?: string }> {
    if (signal?.aborted) throw new ConversionError("internal", "Cancelled");
    onProgress({ progress: null });

    const { api } = getWorker();
    const buffer = await file.arrayBuffer();

    try {
      if (source === "pdf") {
        const pages = await api.pdfToImages(Comlink.transfer(buffer, [buffer]));
        if (pages.length === 0) {
          throw new ConversionError("corrupt", "This PDF has no pages.");
        }

        // Pages come out of pdf.js as PNG. If the user asked for something else,
        // hand each page to the image engine rather than teaching this worker
        // a second set of encoders.
        const encoded = await Promise.all(
          pages.map(async (p) =>
            target === "png"
              ? { buffer: p.buffer, pageNumber: p.pageNumber }
              : {
                  buffer: await convertImageBuffer(p.buffer, "png", target, "image/png", options),
                  pageNumber: p.pageNumber,
                },
          ),
        );

        if (encoded.length === 1) {
          const only = encoded[0]!;
          return { blob: new Blob([only.buffer], { type: FORMATS[target].mime }) };
        }

        // Multi-page → zip. Losing pages 2..n silently would be a data-loss bug
        // dressed up as a feature.
        const { zipSync } = await import("fflate");
        const stem = file.name.replace(/\.pdf$/i, "");
        const entries: Record<string, Uint8Array> = {};
        for (const page of encoded) {
          const n = String(page.pageNumber).padStart(2, "0");
          entries[`${stem}-page-${n}.${FORMATS[target].ext}`] = new Uint8Array(page.buffer);
        }
        // level 0: these are already-compressed images; deflate would burn time
        // to make them very slightly larger.
        const zipped = zipSync(entries, { level: 0 });
        onProgress({ progress: 1 });
        return {
          blob: new Blob([zipped], { type: "application/zip" }),
          filename: `${stem}-${FORMATS[target].ext}-pages.zip`,
        };
      }

      // ---- images → PDF ----
      let embedBuffer = buffer;
      let embedMime = file.type || FORMATS[source].mime;

      if (!PDF_EMBEDDABLE.has(source)) {
        // pdf-lib only embeds JPEG and PNG; transcode anything else first.
        embedBuffer = await convertImageBuffer(buffer, source, "png", embedMime, options);
        embedMime = "image/png";
      }

      const out = await api.imagesToPdf([{ buffer: embedBuffer, mime: embedMime }], options);
      onProgress({ progress: 1 });
      return { blob: new Blob([out], { type: "application/pdf" }) };
    } catch (cause) {
      resetPdfWorker();
      if (cause instanceof ConversionError) throw cause;

      const message = cause instanceof Error ? cause.message : String(cause);
      if (/password|encrypted/i.test(message)) {
        throw new ConversionError("unsupported", "This PDF is password-protected.", {
          suggestion: "Remove the password in your PDF reader first, then try again.",
          cause,
        });
      }
      if (/invalid|corrupt|structure/i.test(message)) {
        throw new ConversionError("corrupt", "This PDF could not be read.", {
          suggestion: "It may be damaged or only partially downloaded.",
          cause,
        });
      }
      throw new ConversionError(
        "internal",
        `Converting ${FORMATS[source].label} to ${FORMATS[target].label} failed.`,
        { cause },
      );
    }
  },
};
