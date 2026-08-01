import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convert, prewarm } from "@/engine/broker";
import { maxConcurrency, probeCapabilities } from "@/engine/capabilities";
import { FORMATS, detectFormat, targetsFor, type FormatId } from "@/engine/formats";
import { ConversionError, newJobId, type ConvertOptions, type Job } from "@/engine/types";
import { installUploadMonitor, getSentBytes, onSentBytesChange } from "@/engine/uploadMonitor";
import { onEngineLoad, FFMPEG_DOWNLOAD_MB } from "@/engine/engineLoad";
import { saveBlob, saveZip } from "@/engine/download";
import { disambiguate, filesFromDrop, rememberTarget, targetForSource } from "@/engine/queue";
import { offlineStatusFor, type OfflineStatus } from "@/engine/offline";

/**
 * `quality` drives image encoders, `audioBitrateKbps` the audio ones. Both are
 * needed: without the second, "Smallest" was a no-op on every audio and video
 * job — a control that was there and did nothing.
 *
 * Lossless is deliberately not "quality: 100". It means *do not re-encode
 * lossily at all*, which for a lossy target is impossible — so the preset
 * reroutes those jobs to a lossless format rather than silently pretending.
 */
const PRESETS = {
  smallest: { label: "Smallest", quality: 55, audioBitrateKbps: 96 },
  balanced: { label: "Balanced", quality: 80, audioBitrateKbps: 192 },
  best: { label: "Best", quality: 95, audioBitrateKbps: 320 },
  lossless: { label: "Lossless", quality: 100, audioBitrateKbps: 320 },
} as const;
type PresetKey = keyof typeof PRESETS;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Targets shared by every queued file, for the "Convert all to" control. */
function commonTargets(jobs: Job[]): FormatId[] {
  if (jobs.length === 0) return [];
  const sets = jobs.map((j) => new Set(targetsFor(j.source).map((f) => f.id)));
  return [...sets[0]!].filter((id) => sets.every((s) => s.has(id)));
}

export default function Converter({
  initialTarget,
  initialSource,
}: { initialTarget?: FormatId; initialSource?: FormatId } = {}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preset, setPreset] = useState<PresetKey>("balanced");
  const [advanced, setAdvanced] = useState(false);
  const [maxDimension, setMaxDimension] = useState<number | "">("");
  const [stripMetadata, setStripMetadata] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);
  const [engineLoad, setEngineLoad] = useState<{ loading: boolean; progress: number | null }>({
    loading: false,
    progress: null,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllers = useRef(new Map<string, AbortController>());

  const [offline, setOffline] = useState<OfflineStatus | null>(null);

  useEffect(() => onEngineLoad(setEngineLoad), []);

  /**
   * Load the codecs for whatever is queued, while the person is still choosing
   * targets and presets. By the time they click Convert the wasm is compiled,
   * so the work starts on the next frame instead of after a download.
   *
   * Runs off the queue rather than inside addFiles because warming is a side
   * effect, and side effects inside a setState updater run twice under React's
   * StrictMode. The worker de-duplicates, so re-running this is free.
   */
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === "queued") void prewarm(job.source, job.target);
    }
  }, [jobs]);

  /**
   * On a pair page, warm before any file exists at all.
   *
   * Someone who searched "heic to jpg" and landed here has already told us what
   * they want; fetching the decoder during the seconds they spend finding the
   * file is the single biggest latency win available. Deliberately skipped when
   * the browser reports Data Saver or a 2G-class connection — speculative
   * megabytes are a real cost to somebody, and this is a guess, however good.
   */
  useEffect(() => {
    if (!initialSource || !initialTarget) return;
    const conn = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /^(slow-)?2g$/.test(conn.effectiveType)) return;

    // After first paint, so the warm competes with nothing the user can see.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
    const handle = idle(() => void prewarm(initialSource, initialTarget));
    return () => window.cancelIdleCallback?.(handle as number);
  }, [initialSource, initialTarget]);

  /**
   * The trust surface. Counts bytes this page SENDS — see uploadMonitor for why
   * this cannot be done with PerformanceObserver. It should read zero forever,
   * and if a change ever introduces an upload, this catches it in front of the
   * user rather than in a privacy audit six months later.
   */
  useEffect(() => {
    installUploadMonitor();
    setUploadedBytes(getSentBytes());
    return onSentBytesChange(setUploadedBytes);
  }, []);

  const update = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setJobs((prev) => {
        // Names are made unique across the WHOLE queue, not just this batch —
        // dropping the same folder twice would otherwise produce silent
        // overwrites at download time.
        const taken = new Set(prev.map((j) => j.file.name));
        const next: Job[] = [];

        for (const file of Array.from(files)) {
          const name = disambiguate(file.name, taken);
          taken.add(name);
          // Rename by wrapping rather than mutating: File.name is read-only.
          const entry = name === file.name ? file : new File([file], name, { type: file.type });

          const source = detectFormat(entry);
          if (!source) {
            // Named explicitly rather than silently dropped — a file that
            // vanishes from the queue reads as a broken site.
            next.push({
              id: newJobId(),
              file: entry,
              source: "png",
              target: "png",
              options: {},
              status: "failed",
              progress: null,
              error: new ConversionError("unsupported", `We don't recognise "${entry.name}".`, {
                suggestion: "Check the file extension, or try a different file.",
              }),
            });
            continue;
          }
          next.push({
            id: newJobId(),
            file: entry,
            source,
            // A pair page has already told us what the visitor came for, so
            // honour it — but only when it is actually reachable from this
            // source, since they may drop something unrelated on the page.
            target:
              initialTarget && targetsFor(source).some((f) => f.id === initialTarget)
                ? initialTarget
                : targetForSource(source),
            options: {},
            status: "queued",
            progress: null,
          });
        }
        return [...prev, ...next];
      });
      // initialTarget comes from the pair page and is stable for the page's life,
      // but declaring it keeps the hook honest rather than relying on that.
    },
    [initialTarget],
  );

  const setTarget = useCallback((id: string, target: FormatId) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        // Remember per source format, so a folder of HEICs only needs telling
        // once that they should become PNG.
        rememberTarget(j.source, target);
        return { ...j, target, status: "queued", result: undefined, error: undefined };
      }),
    );
  }, []);

  const optionsFor = useCallback(
    (target: FormatId): ConvertOptions => ({
      quality: PRESETS[preset].quality,
      audioBitrateKbps: PRESETS[preset].audioBitrateKbps,
      stripMetadata,
      ...(maxDimension ? { maxDimension: Number(maxDimension) } : {}),
      // Lossless on a lossy target is not achievable, and quality 100 is not
      // the same thing. The honest move is to say so on the row rather than
      // produce a large file and imply it is lossless.
      ...(preset === "lossless" && FORMATS[target].lossy ? { quality: 100 } : {}),
    }),
    [preset, stripMetadata, maxDimension],
  );

  const runJob = useCallback(
    async (job: Job) => {
      const controller = new AbortController();
      abortControllers.current.set(job.id, controller);
      update(job.id, { status: "running", progress: null, error: undefined });
      try {
        const result = await convert(
          job.file,
          job.source,
          job.target,
          optionsFor(job.target),
          ({ progress }) => update(job.id, { progress }),
          controller.signal,
        );
        update(job.id, { status: "done", progress: 1, result });
      } catch (err) {
        const cancelled = controller.signal.aborted;
        update(job.id, {
          status: cancelled ? "cancelled" : "failed",
          progress: null,
          error: cancelled
            ? undefined
            : err instanceof ConversionError
              ? err
              : new ConversionError("internal", "Something went wrong converting this file."),
        });
      } finally {
        abortControllers.current.delete(job.id);
      }
    },
    [optionsFor, update],
  );

  /**
   * Run the queue N at a time rather than all at once.
   *
   * `maxConcurrency` existed from the start and was only ever *displayed* — the
   * diagnostics panel told people "3 at a time" while this fired every job
   * simultaneously. On a fast machine that is merely untrue; on a 2-core one it
   * is a mixed batch of ten files finishing seven of them, because each job
   * holds a wasm instance and they starve each other.
   *
   * A pool of workers pulling from a shared cursor, so a slow file delays only
   * itself rather than a whole batch boundary.
   */
  const runAll = useCallback(async () => {
    const queue = jobs.filter((j) => j.status === "queued" || j.status === "failed");
    if (queue.length === 0) return;

    // A batch of images may run wider than a batch of video. If the queue
    // mixes them, the heavier kind decides — one 2 GB ffmpeg job alongside six
    // images is still one 2 GB ffmpeg job.
    const anyMedia = queue.some((j) => {
      const kind = FORMATS[j.source].kind;
      return kind === "audio" || kind === "video";
    });
    const limit = maxConcurrency(await probeCapabilities(), anyMedia ? "media" : "image");
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (cursor < queue.length) {
          const job = queue[cursor++];
          if (job) await runJob(job);
        }
      }),
    );
  }, [jobs, runJob]);

  const cancel = useCallback((id: string) => {
    abortControllers.current.get(id)?.abort();
  }, []);

  const remove = useCallback(
    (id: string) => {
      cancel(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    },
    [cancel],
  );

  const convertAllTo = useCallback((target: FormatId) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (!targetsFor(j.source).some((f) => f.id === target)) return j;
        rememberTarget(j.source, target);
        return { ...j, target, status: "queued", result: undefined, error: undefined };
      }),
    );
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      // Read the items synchronously — they are neutered once the handler
      // yields, which is why this is not simply `await`ed inline.
      void filesFromDrop(e.dataTransfer).then((files) => {
        if (files.length) addFiles(files);
      });
    },
    [addFiles],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) addFiles(e.clipboardData.files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  /**
   * Offline capability for the pairs actually queued.
   *
   * Recomputed after conversions finish, because that is when a codec lands in
   * the cache and the answer changes from "no" to "yes". A badge that only
   * checks on mount tells people they have no offline support immediately after
   * they earned it.
   */
  const pairKey = jobs.map((j) => `${j.source}>${j.target}`).join(",");
  const doneCount = jobs.filter((j) => j.status === "done").length;
  useEffect(() => {
    if (!pairKey) return setOffline(null);
    let alive = true;
    void (async () => {
      // Read the pairs back out of the key rather than closing over `jobs`.
      // Depending on `jobs` would re-run this on every progress tick, since the
      // array is rebuilt each time; closing over it without declaring it needs
      // the lint rule silenced, which hides genuine staleness. The key IS the
      // data this effect needs, so it can be the only dependency.
      const pairs = pairKey.split(",").map((p) => p.split(">") as [FormatId, FormatId]);
      const results = await Promise.all(pairs.map(([s, t]) => offlineStatusFor(s, t)));
      if (!alive) return;
      // The queue is offline-capable only if EVERY pair in it is. Claiming
      // otherwise would be true on average and wrong for the file that matters.
      setOffline({
        ready: results.every((r) => r.ready),
        pairAvailable: results.every((r) => r.pairAvailable),
        needsNothingExtra: results.every((r) => r.needsNothingExtra),
      });
    })();
    return () => {
      alive = false;
    };
  }, [pairKey, doneCount]);

  const done = jobs.filter((j) => j.status === "done");
  const running = jobs.filter((j) => j.status === "running");
  const pending = jobs.some((j) => j.status === "queued" || j.status === "failed");

  /**
   * Overall progress, mirrored into the tab title.
   *
   * A batch of video takes long enough that people switch tabs. Putting the
   * percentage in the title is the only way they learn it finished without
   * coming back to look.
   */
  const overall = useMemo(() => {
    const relevant = jobs.filter((j) => j.status !== "cancelled");
    if (relevant.length === 0) return null;
    const total = relevant.reduce(
      (sum, j) => sum + (j.status === "done" ? 1 : j.status === "running" ? (j.progress ?? 0) : 0),
      0,
    );
    return total / relevant.length;
  }, [jobs]);

  useEffect(() => {
    const base = "Onhand — convert any file, nothing uploaded";
    if (running.length === 0 || overall === null) {
      document.title = base;
      return;
    }
    document.title = `${Math.round(overall * 100)}% — Onhand`;
    return () => {
      document.title = base;
    };
  }, [running.length, overall]);

  const downloadAll = useCallback(async () => {
    const entries = done
      .filter((j) => j.result)
      .map((j) => ({ filename: j.result!.filename, blob: j.result!.blob }));
    if (entries.length === 0) return;
    setZipping({ done: 0, total: entries.length });
    try {
      await saveZip(entries, "onhand.zip", (d, t) => setZipping({ done: d, total: t }));
    } finally {
      setZipping(null);
    }
  }, [done]);

  const shared = commonTargets(jobs);

  return (
    <div className="w-full">
      {/*
        The drop zone is a plain region, NOT role="button".
        A button may not contain interactive content, and this one contained a
        file input — axe flags it as nested-interactive, and screen readers
        genuinely disagree about what such a control is. The keyboard entry
        point is the real <button> inside; the input sits beside it, labelled,
        and out of tab order so there is one control here rather than two.
      */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        className={`rounded-2xl border-2 border-dashed transition-colors motion-reduce:transition-none ${
          dragging
            ? "border-copper-500 bg-glass-200 dark:bg-glass-800"
            : "border-glass-200 bg-glass-100 hover:border-copper-400 dark:border-glass-800 dark:bg-glass-900"
        }`}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl px-6 py-10 sm:py-16"
        >
          {/* The mark, reused from the favicon: a hand cupping a file. */}
          <svg
            viewBox="0 0 32 32"
            aria-hidden="true"
            className={`mb-4 h-9 w-9 transition-colors motion-reduce:transition-none ${
              dragging ? "text-copper-500" : "text-glass-400 dark:text-glass-600"
            }`}
          >
            <rect
              x="10"
              y="2"
              width="12"
              height="13"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M13.5 6h5M13.5 9.5h5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M5 21a3 3 0 0 1 5-2.2l2 1.8V13a1.7 1.7 0 0 1 3.4 0v4.5a1.7 1.7 0 0 1 3.4 0v.8a1.7 1.7 0 0 1 3.4 0v.9a1.7 1.7 0 0 1 3.4 0V24a6 6 0 0 1-6 6h-4.3a6 6 0 0 1-4.6-2.2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-xl font-medium sm:text-2xl">
            {dragging ? "Let go." : "Drop anything."}
          </span>
          <span className="mt-2 max-w-sm text-center text-sm text-glass-600 dark:text-glass-400">
            Converted on your device. Nothing is uploaded — watch the network tab if you don't
            believe us.
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Choose files to convert"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            // Reset so choosing the same file twice fires change again.
            e.target.value = "";
          }}
        />
      </div>

      {/*
        Always visible, including the zero state. This is the product's whole
        claim and it used to appear only once a file was queued — absent at
        exactly the moment someone is deciding whether to believe the page.
      */}
      <p className="mt-3 text-center font-mono text-xs text-copper-700 dark:text-copper-400">
        ↑ {uploadedBytes === 0 ? "0 bytes" : humanSize(uploadedBytes)} uploaded
      </p>

      {jobs.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-glass-200 bg-glass-100 p-3 dark:border-glass-800 dark:bg-glass-900">
            <div
              className="flex gap-0.5 rounded-xl bg-glass-200 p-1 dark:bg-glass-800"
              role="group"
              aria-label="Quality preset"
            >
              {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setPreset(key)}
                  aria-pressed={preset === key}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-[var(--ease-out-quart)] motion-reduce:transition-none ${
                    preset === key
                      ? "bg-copper-600 text-white shadow-sm"
                      : "text-glass-600 hover:bg-glass-100 hover:text-glass-900 dark:text-glass-400 dark:hover:bg-glass-900 dark:hover:text-glass-100"
                  }`}
                >
                  {PRESETS[key].label}
                </button>
              ))}
            </div>

            {shared.length > 1 && (
              <label className="text-sm text-glass-600 dark:text-glass-400">
                <span className="sr-only">Convert all to</span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) convertAllTo(e.target.value as FormatId);
                    e.target.value = "";
                  }}
                  className="rounded-lg border border-glass-200 bg-glass-50 px-2.5 py-1.5 text-sm dark:border-glass-800 dark:bg-glass-950"
                >
                  <option value="">Convert all to…</option>
                  {shared.map((id) => (
                    <option key={id} value={id}>
                      {FORMATS[id].label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              onClick={() => void runAll()}
              disabled={!pending}
              className="rounded-lg bg-copper-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-[var(--ease-out-quart)] hover:bg-copper-700 disabled:opacity-40 disabled:hover:bg-copper-600 motion-reduce:transition-none"
            >
              Convert {jobs.filter((j) => j.status === "queued").length || ""}
            </button>

            {done.length > 1 && (
              <button
                onClick={() => void downloadAll()}
                disabled={zipping !== null}
                className="rounded-lg border border-glass-200 bg-glass-50 px-4 py-2 text-sm font-medium transition-colors duration-150 ease-[var(--ease-out-quart)] hover:border-copper-400 disabled:opacity-40 motion-reduce:transition-none dark:border-glass-800 dark:bg-glass-950"
              >
                {zipping
                  ? `Zipping ${zipping.done}/${zipping.total}…`
                  : `Download all (${done.length})`}
              </button>
            )}

            {offline?.pairAvailable && (
              <span
                className="ml-auto font-mono text-xs text-glass-600 dark:text-glass-400"
                title={
                  offline.needsNothingExtra
                    ? "These formats use codecs already built into your browser."
                    : "The codecs for these formats are cached on this device."
                }
              >
                ✈ works offline
              </span>
            )}
          </div>

          <div className="mt-2">
            <button
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="text-xs text-glass-600 dark:text-glass-400 hover:text-copper-500"
            >
              {advanced ? "▾" : "▸"} Advanced
            </button>
            {advanced && (
              <div className="mt-2 flex flex-wrap items-center gap-4 rounded-lg border border-glass-200 px-3 py-2 text-sm dark:border-glass-800">
                <label className="flex items-center gap-2">
                  Longest edge
                  <input
                    type="number"
                    min={16}
                    step={16}
                    placeholder="original"
                    value={maxDimension}
                    onChange={(e) =>
                      setMaxDimension(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="w-24 rounded border border-glass-200 bg-transparent px-2 py-1 dark:border-glass-800"
                  />
                  px
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stripMetadata}
                    onChange={(e) => setStripMetadata(e.target.checked)}
                  />
                  Strip metadata
                </label>
                {/*
                  Says what it actually does, rather than implying it governs
                  everything. Images are decoded to pixels and re-encoded, so
                  EXIF has nowhere to survive — unticking this cannot bring it
                  back, and pretending otherwise would be a control that does
                  nothing. It is genuinely a switch for audio and video, where
                  ffmpeg is asked to drop the tags or keep them.
                */}
                <span className="text-xs text-glass-600 dark:text-glass-400">
                  On by default — photos carry the GPS coordinates of where they were taken. Images
                  always lose it either way, because converting rebuilds the pixels. The switch is
                  for audio and video tags.
                </span>
              </div>
            )}
          </div>

          {engineLoad.loading && (
            <div
              className="mt-4 rounded-lg border border-glass-200 px-3 py-2 text-sm text-glass-600 dark:border-glass-800 dark:text-glass-400"
              role="status"
              aria-live="polite"
            >
              Getting the engine for this format —{" "}
              <span className="font-mono">
                {engineLoad.progress === null
                  ? `${FFMPEG_DOWNLOAD_MB} MB`
                  : `${Math.round(engineLoad.progress * FFMPEG_DOWNLOAD_MB)} of ${FFMPEG_DOWNLOAD_MB} MB`}
              </span>
              , once. It stays cached after this.
              {engineLoad.progress !== null && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-glass-200 dark:bg-glass-800">
                  <div
                    className="h-full bg-copper-500 transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${engineLoad.progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <ul className="mt-4 divide-y divide-glass-200 overflow-hidden rounded-2xl border border-glass-200 dark:divide-glass-800 dark:border-glass-800">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                preset={preset}
                onTarget={setTarget}
                onCancel={cancel}
                onRemove={remove}
              />
            ))}
          </ul>

          {/* One announcement for the whole queue. Announcing per row would
              read fifty progress updates aloud, which is worse than silence. */}
          <p className="sr-only" role="status" aria-live="polite">
            {running.length > 0
              ? `Converting, ${Math.round((overall ?? 0) * 100)} percent complete.`
              : done.length > 0
                ? `${done.length} of ${jobs.length} files converted.`
                : ""}
          </p>
        </>
      )}
    </div>
  );
}

function JobRow({
  job,
  preset,
  onTarget,
  onCancel,
  onRemove,
}: {
  job: Job;
  preset: PresetKey;
  onTarget: (id: string, target: FormatId) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const delta = job.result ? 1 - job.result.bytesOut / job.result.bytesIn : 0;
  // "Lossless" cannot be honoured by a lossy container. Say so on the row
  // rather than producing a big file and letting the label imply otherwise.
  const losslessImpossible = preset === "lossless" && FORMATS[job.target].lossy;

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 py-3 text-sm sm:grid-cols-[1fr_auto_auto_auto_auto]">
      {/*
        Its own grid cell, spanning the full width on small screens. As one
        flex line this truncated to a single character on a 375px viewport —
        you could not tell which file was which, which is the one thing a
        queue row has to do.
      */}
      <span className="col-span-2 min-w-0 truncate font-medium sm:col-span-1" title={job.file.name}>
        {job.file.name}
      </span>

      <select
        value={job.target}
        onChange={(e) => onTarget(job.id, e.target.value as FormatId)}
        disabled={job.status === "running"}
        aria-label={`Target format for ${job.file.name}`}
        className="rounded border border-glass-200 bg-transparent px-2 py-1 dark:border-glass-800"
      >
        {targetsFor(job.source).map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>

      <span className="w-56 text-right tabular-nums text-glass-600 dark:text-glass-400">
        {job.status === "queued" && (
          <>
            {humanSize(job.file.size)}
            {losslessImpossible && (
              <span
                className="ml-1 text-xs text-glass-600 dark:text-glass-400"
                title="This format is always lossy"
              >
                (lossy format)
              </span>
            )}
          </>
        )}
        {job.status === "running" &&
          (job.progress === null ? "Converting…" : `${Math.round(job.progress * 100)}%`)}
        {job.status === "cancelled" && "Cancelled"}
        {job.status === "done" && job.result && (
          <>
            <span className="tabular-nums">
              {humanSize(job.result.bytesIn)} → {humanSize(job.result.bytesOut)}
            </span>{" "}
            <span
              className={`rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                delta > 0
                  ? "bg-copper-600 text-white"
                  : "bg-glass-200 text-glass-600 dark:bg-glass-800 dark:text-glass-400"
              }`}
            >
              {delta > 0 ? "−" : "+"}
              {Math.abs(Math.round(delta * 100))}%
            </span>
          </>
        )}
        {job.status === "failed" && job.error && (
          <span title={job.error.suggestion}>{job.error.message}</span>
        )}
      </span>

      {job.status === "done" && job.result && (
        <button
          onClick={() => void saveBlob(job.result!.blob, job.result!.filename)}
          className="rounded-lg bg-copper-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-[var(--ease-out-quart)] hover:bg-copper-700 motion-reduce:transition-none"
        >
          Save
        </button>
      )}

      {job.status === "running" ? (
        <button
          onClick={() => onCancel(job.id)}
          aria-label={`Cancel converting ${job.file.name}`}
          className="rounded px-2 py-1 text-glass-600 dark:text-glass-400 hover:text-copper-500"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={() => onRemove(job.id)}
          aria-label={`Remove ${job.file.name} from the queue`}
          className="rounded px-2 py-1 text-glass-600 dark:text-glass-400 hover:text-copper-500"
        >
          ✕
        </button>
      )}

      {job.error?.suggestion && (
        <p className="w-full text-xs text-glass-600 dark:text-glass-400">{job.error.suggestion}</p>
      )}
    </li>
  );
}
