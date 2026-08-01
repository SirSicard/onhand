import { defaultTargetFor, targetsFor, type FormatId } from "./formats";

/**
 * Queue behaviour that is worth testing on its own: what target a file gets,
 * and what a file ends up called.
 *
 * Both are small, both are the sort of thing that quietly goes wrong, and both
 * are far easier to get right here than inside a component.
 */

const STORAGE_KEY = "onhand:target-memory";

type TargetMemory = Partial<Record<FormatId, FormatId>>;

/**
 * Remember the last target chosen for each source format.
 *
 * Someone converting a folder of HEICs to PNG rather than the JPEG default
 * should not have to change the dropdown thirty times. Scoped by SOURCE format,
 * because the useful pattern is "HEICs go to PNG", not "everything goes to PNG".
 *
 * localStorage is wrapped because it throws outright in Safari's private mode
 * and when a browser is configured to block storage — a preference not being
 * remembered is a minor loss, a crashed page is not.
 */
function readMemory(): TargetMemory {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TargetMemory) : {};
  } catch {
    return {};
  }
}

export function rememberTarget(source: FormatId, target: FormatId): void {
  try {
    const memory = readMemory();
    memory[source] = target;
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Storage unavailable. The app works, it just forgets.
  }
}

export function forgetTargets(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}

/**
 * The target a newly-added file should get: remembered choice if there is a
 * valid one, otherwise the built-in default.
 */
export function targetForSource(source: FormatId): FormatId {
  const remembered = readMemory()[source];
  // Validate rather than trust: the stored value may predate a change to what
  // is reachable from this source, and an unreachable target would render a
  // select whose value is not among its options.
  if (remembered && targetsFor(source).some((f) => f.id === remembered)) return remembered;
  return defaultTargetFor(source);
}

/**
 * Make a filename unique against those already used.
 *
 * Two different inputs routinely produce the same output name — photo.png and
 * photo.jpg both become photo.webp. Downloading them in turn leaves the user
 * with one file and no indication the other was overwritten.
 */
export function disambiguate(filename: string, taken: ReadonlySet<string>): string {
  if (!taken.has(filename)) return filename;
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Pull every File out of a drop, including the contents of dropped folders.
 *
 * `DataTransfer.files` is flat and silently omits folder contents entirely, so
 * dropping a folder of holiday photos appears to do nothing at all. The
 * entries API is the only way to walk into them, and it must be read
 * synchronously during the drop event — the items are neutered the moment the
 * handler yields.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  // No entries API (or nothing usable) — fall back to the flat list, which at
  // least handles loose files correctly.
  if (entries.length === 0) return Array.from(dataTransfer.files);

  const files: File[] = [];
  const MAX_FILES = 2000; // a runaway directory tree should not hang the tab

  async function walk(entry: FileSystemEntry): Promise<void> {
    if (files.length >= MAX_FILES) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      // Skip the invisible clutter every macOS folder carries.
      if (file && !file.name.startsWith(".")) files.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        // readEntries returns at most 100 at a time and signals the end with an
        // empty batch — reading it once silently truncates a large folder.
        const batch = await new Promise<FileSystemEntry[]>((resolve) =>
          reader.readEntries(resolve, () => resolve([])),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }

  await Promise.all(entries.map(walk));
  return files;
}
