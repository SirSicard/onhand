/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { ConvertOptions } from "../types";

/**
 * PDF worker — both directions.
 *
 *   PDF  → images   via pdf.js (renders each page to a canvas)
 *   images → PDF    via pdf-lib (one image per page, page sized to the image)
 *
 * Kept separate from the image worker because pdf.js is ~1 MB and nobody
 * converting a HEIC should download a PDF renderer to do it.
 */

/** A PDF with many pages produces many images; the caller decides what to do with them. */
export interface RenderedPage {
  buffer: ArrayBuffer;
  pageNumber: number;
  width: number;
  height: number;
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  // pdf.js insists on its own worker and will not run without one — setting
  // workerSrc to "" throws `No "GlobalWorkerOptions.workerSrc" specified`
  // rather than falling back to inline execution. So we point it at the
  // bundled worker and let it nest one inside this one, which browsers
  // permit and pdf.js expects.
  //
  // The `?url` suffix makes Vite emit the file as an asset and hand back its
  // hashed URL instead of trying to inline the module.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

const api = {
  /**
   * Render every page of a PDF to PNG.
   *
   * `scale` trades file size against legibility. 2.0 renders at roughly twice
   * CSS-pixel size, which is what makes text in the output readable rather than
   * mushy — the default most tools get wrong by rendering at 1.0.
   */
  async pdfToImages(buffer: ArrayBuffer, scale = 2.0): Promise<RenderedPage[]> {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // No network fetches, ever — a PDF must not be able to phone home.
      disableAutoFetch: true,
      disableStream: true,
    }).promise;

    const pages: RenderedPage[] = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale });
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.floor(viewport.width)),
          Math.max(1, Math.floor(viewport.height)),
        );
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context in worker");

        // PDFs assume a white page. Without this, transparent areas render
        // black in the output, which looks like a broken conversion.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        const blob = await canvas.convertToBlob({ type: "image/png" });
        pages.push({
          buffer: await blob.arrayBuffer(),
          pageNumber: n,
          width: canvas.width,
          height: canvas.height,
        });
        page.cleanup();
      }
    } finally {
      // v6 renamed destroy() to cleanup(); guard so either build works.
      const d = doc as unknown as { destroy?: () => Promise<void>; cleanup?: () => void };
      if (typeof d.destroy === "function") await d.destroy();
      else d.cleanup?.();
    }
    return pages;
  },

  /**
   * Build a PDF from images, one image per page.
   *
   * pdf-lib embeds JPEG and PNG natively. Anything else must be transcoded to
   * PNG by the image worker first — the broker arranges that rather than this
   * worker growing a second set of codecs.
   */
  async imagesToPdf(
    images: { buffer: ArrayBuffer; mime: string }[],
    _options: ConvertOptions,
  ): Promise<ArrayBuffer> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();

    for (const img of images) {
      const bytes = new Uint8Array(img.buffer);
      const embedded =
        img.mime === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      // Page matches the image exactly — no letterboxing, no arbitrary A4
      // default that crops or pads someone's screenshot.
      const page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }

    if (doc.getPageCount() === 0) {
      throw new Error("no images to place in the PDF");
    }
    const out = await doc.save();
    // Copy into a fresh ArrayBuffer so it can be transferred back cleanly.
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  },
};

export type PdfWorkerApi = typeof api;

Comlink.expose(api);
