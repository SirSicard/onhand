import { useEffect, useState } from "react";
import { probeCapabilities, maxConcurrency, type Capabilities } from "@/engine/capabilities";

/**
 * P0 acceptance surface: proves cross-origin isolation is live in production and
 * shows what this browser can actually do.
 *
 * This is scaffolding with a purpose — it becomes the diagnostics panel behind
 * the "why is my conversion slow / unsupported" question, which every converter
 * gets and none of them answer honestly.
 */
export default function EnvironmentReport() {
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    let alive = true;
    probeCapabilities().then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!caps) {
    return (
      <p className="text-sm text-glass-400" aria-live="polite">
        Checking what this browser can do…
      </p>
    );
  }

  const codecList = (rec: Record<string, { supported: boolean; codec?: string }>) =>
    Object.entries(rec)
      .filter(([, v]) => v.supported)
      .map(([k]) => k)
      .join(", ") || "none";

  const anySupported = (rec: Record<string, { supported: boolean }>) =>
    Object.values(rec).some((v) => v.supported);

  return (
    <div className="w-full max-w-xl text-left">
      <Row
        label="Cross-origin isolated"
        ok={caps.crossOriginIsolated}
        detail={caps.crossOriginIsolated ? "COOP + COEP active" : "headers not applied"}
      />
      <Row
        label="SharedArrayBuffer"
        ok={caps.sharedArrayBuffer}
        detail={caps.sharedArrayBuffer ? "multithreading possible" : "single-thread only"}
      />
      <Row
        label="WebCodecs"
        ok={caps.webCodecs.available}
        detail={
          caps.webCodecs.available
            ? `encode: ${codecList(caps.webCodecs.videoEncode)}`
            : "falls back to ffmpeg.wasm"
        }
      />
      <Row
        label="Audio encode"
        ok={anySupported(caps.webCodecs.audioEncode)}
        detail={codecList(caps.webCodecs.audioEncode)}
      />
      <Row
        label="H.264 profile in use"
        ok={caps.webCodecs.videoEncode.h264.supported}
        detail={
          caps.webCodecs.videoEncode.h264.codec ??
          "unavailable — mp4 encodes fall back to ffmpeg"
        }
      />
      <Row
        label="Stream to disk"
        ok={caps.fileSystemAccess}
        detail={caps.fileSystemAccess ? "File System Access API" : "in-memory, then download"}
      />
      <Row
        label="Parallel jobs"
        ok
        detail={`${maxConcurrency(caps)} at a time${
          caps.memoryConstrainedPlatform ? " (memory-constrained platform)" : ""
        }`}
      />
    </div>
  );
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-glass-200 py-2 last:border-0 dark:border-glass-800">
      <span
        aria-hidden="true"
        className={ok ? "text-copper-500" : "text-glass-400"}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {ok ? "●" : "○"}
      </span>
      <span className="min-w-44 text-sm font-medium">{label}</span>
      <span className="text-sm text-glass-600 dark:text-glass-400">{detail}</span>
      <span className="sr-only">{ok ? "supported" : "not supported"}</span>
    </div>
  );
}
