import { useCallback, useEffect, useRef, useState } from "react";
import { convert } from "@/engine/broker";
import {
  defaultTargetFor,
  detectFormat,
  targetsFor,
  type FormatId,
} from "@/engine/formats";
import { ConversionError, newJobId, type Job } from "@/engine/types";
import { installUploadMonitor, getSentBytes, onSentBytesChange } from "@/engine/uploadMonitor";

// `quality` drives image encoders; `audioBitrateKbps` drives the audio ones.
// Without the second field "Smallest" was a no-op on every audio and video job
// — the control was there and did nothing.
const PRESETS = {
  smallest: { label: "Smallest", quality: 55, audioBitrateKbps: 96 },
  balanced: { label: "Balanced", quality: 80, audioBitrateKbps: 192 },
  best: { label: "Best", quality: 95, audioBitrateKbps: 320 },
} as const;
type PresetKey = keyof typeof PRESETS;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Converter() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preset, setPreset] = useState<PresetKey>("balanced");
  const [dragging, setDragging] = useState(false);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Job[] = [];
    for (const file of Array.from(files)) {
      const source = detectFormat(file);
      if (!source) {
        // Named explicitly rather than silently dropped — a file that vanishes
        // from the queue reads as a broken site.
        next.push({
          id: newJobId(),
          file,
          source: "png",
          target: "png",
          options: {},
          status: "failed",
          progress: null,
          error: new ConversionError("unsupported", `We don't recognise "${file.name}".`, {
            suggestion: "Check the file extension, or try a different file.",
          }),
        });
        continue;
      }
      next.push({
        id: newJobId(),
        file,
        source,
        target: defaultTargetFor(source),
        options: {},
        status: "queued",
        progress: null,
      });
    }
    setJobs((prev) => [...prev, ...next]);
  }, []);

  const runJob = useCallback(
    async (job: Job) => {
      update(job.id, { status: "running", progress: null, error: undefined });
      try {
        const result = await convert(
          job.file,
          job.source,
          job.target,
          {
            quality: PRESETS[preset].quality,
            audioBitrateKbps: PRESETS[preset].audioBitrateKbps,
            stripMetadata: true,
          },
          ({ progress }) => update(job.id, { progress }),
        );
        update(job.id, { status: "done", progress: 1, result });
      } catch (err) {
        update(job.id, {
          status: "failed",
          progress: null,
          error:
            err instanceof ConversionError
              ? err
              : new ConversionError("internal", "Something went wrong converting this file."),
        });
      }
    },
    [preset, update],
  );

  const runAll = useCallback(() => {
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "failed") void runJob(job);
    }
  }, [jobs, runJob]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
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

  const pending = jobs.some((j) => j.status === "queued");

  return (
    <div className="w-full">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Drop files here, or press Enter to browse"
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 transition-colors ${
          dragging
            ? "border-copper-500 bg-copper-500/5"
            : "border-glass-200 hover:border-copper-400 dark:border-glass-800"
        }`}
      >
        <p className="text-xl font-medium">Drop anything.</p>
        <p className="mt-2 text-center text-sm text-glass-600 dark:text-glass-400">
          Converted on your device. Nothing is uploaded —<br />
          watch the network tab if you don't believe us.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {jobs.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg border border-glass-200 p-1 dark:border-glass-800">
              {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setPreset(key)}
                  aria-pressed={preset === key}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    preset === key
                      ? "bg-copper-500 text-white"
                      : "text-glass-600 hover:text-copper-500 dark:text-glass-400"
                  }`}
                >
                  {PRESETS[key].label}
                </button>
              ))}
            </div>
            <button
              onClick={runAll}
              disabled={!pending}
              className="rounded-lg bg-copper-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Convert {jobs.filter((j) => j.status === "queued").length || ""}
            </button>
            <span className="ml-auto font-mono text-xs text-glass-400">
              ↑ {uploadedBytes === 0 ? "0 bytes" : humanSize(uploadedBytes)} uploaded
            </span>
          </div>

          <ul className="mt-4 divide-y divide-glass-200 dark:divide-glass-800">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate" title={job.file.name}>
                  {job.file.name}
                </span>

                <select
                  value={job.target}
                  onChange={(e) => update(job.id, { target: e.target.value as FormatId })}
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

                <span className="w-52 text-right text-glass-600 dark:text-glass-400" aria-live="polite">
                  {job.status === "running" && (job.progress === null ? "Converting…" : `${Math.round(job.progress * 100)}%`)}
                  {job.status === "queued" && humanSize(job.file.size)}
                  {job.status === "done" && job.result && (
                    <>
                      {humanSize(job.result.bytesIn)} → {humanSize(job.result.bytesOut)}{" "}
                      <span className={job.result.bytesOut < job.result.bytesIn ? "text-copper-500" : ""}>
                        ({job.result.bytesOut < job.result.bytesIn ? "−" : "+"}
                        {Math.abs(
                          Math.round((1 - job.result.bytesOut / job.result.bytesIn) * 100),
                        )}
                        %)
                      </span>
                    </>
                  )}
                  {job.status === "failed" && job.error && (
                    <span className="text-glass-600 dark:text-glass-400">{job.error.message}</span>
                  )}
                </span>

                {job.status === "done" && job.result && (
                  <a
                    href={URL.createObjectURL(job.result.blob)}
                    download={job.result.filename}
                    className="rounded bg-copper-500 px-3 py-1 text-white"
                  >
                    Save
                  </a>
                )}
              </li>
            ))}
          </ul>

          {jobs.some((j) => j.error?.suggestion) && (
            <p className="mt-3 text-xs text-glass-400">
              {jobs.find((j) => j.error?.suggestion)?.error?.suggestion}
            </p>
          )}
        </>
      )}
    </div>
  );
}
