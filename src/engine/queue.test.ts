import { describe, it, expect, beforeEach } from "vitest";
import { disambiguate, forgetTargets, rememberTarget, targetForSource } from "./queue";
import { defaultTargetFor, FORMATS, targetsFor } from "./formats";

describe("disambiguate", () => {
  it("leaves a unique name alone", () => {
    expect(disambiguate("photo.webp", new Set())).toBe("photo.webp");
  });

  it("numbers a collision before the extension, not after", () => {
    // "photo.webp (2)" would strip the file of a usable extension, and the OS
    // then has no idea what it is.
    expect(disambiguate("photo.webp", new Set(["photo.webp"]))).toBe("photo (2).webp");
  });

  it("keeps counting past the first collision", () => {
    const taken = new Set(["a.png", "a (2).png", "a (3).png"]);
    expect(disambiguate("a.png", taken)).toBe("a (4).png");
  });

  it("handles a name with no extension", () => {
    expect(disambiguate("README", new Set(["README"]))).toBe("README (2)");
  });

  it("handles a dotfile without treating the whole name as an extension", () => {
    // lastIndexOf('.') is 0 here, so a naive split yields an empty stem.
    expect(disambiguate(".gitignore", new Set([".gitignore"]))).toBe(".gitignore (2)");
  });

  it("is the real-world case: two sources converging on one output name", () => {
    // photo.png and photo.jpg both become photo.webp. Without this, one
    // silently overwrites the other on download.
    const taken = new Set<string>();
    const first = disambiguate("photo.webp", taken);
    taken.add(first);
    const second = disambiguate("photo.webp", taken);
    expect([first, second]).toEqual(["photo.webp", "photo (2).webp"]);
  });
});

/**
 * Node has no localStorage (it needs --localstorage-file), so without a stub
 * every write here is silently a no-op and these tests would pass by doing
 * nothing at all. The degradation path is covered by its own test below.
 */
function stubStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
}

describe("target memory", () => {
  beforeEach(() => {
    stubStorage();
    forgetTargets();
  });

  it("falls back to the built-in default when nothing is remembered", () => {
    expect(targetForSource("heic")).toBe(defaultTargetFor("heic"));
  });

  it("remembers a choice per source format", () => {
    // The point: a folder of HEICs should need telling once, not thirty times.
    rememberTarget("heic", "png");
    expect(targetForSource("heic")).toBe("png");
    // And it must not leak across source formats.
    expect(targetForSource("jpeg")).toBe(defaultTargetFor("jpeg"));
  });

  it("ignores a remembered target that is no longer reachable", () => {
    // A stored value can outlive a change to the format table. Handing a select
    // a value that is not among its options makes the browser silently show the
    // first option instead — the UI would then disagree with the state.
    rememberTarget("mp3", "png");
    const chosen = targetForSource("mp3");
    expect(targetsFor("mp3").map((f) => f.id)).toContain(chosen);
    expect(chosen).toBe(defaultTargetFor("mp3"));
  });

  it("survives storage being unavailable", () => {
    // Safari private mode throws on setItem. Losing a preference is acceptable;
    // throwing during render is not.
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    try {
      expect(() => rememberTarget("heic", "png")).not.toThrow();
      expect(() => targetForSource("heic")).not.toThrow();
      expect(targetForSource("heic")).toBe(defaultTargetFor("heic"));
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: real,
      });
    }
  });

  it("returns a reachable target for every format in the registry", () => {
    for (const f of Object.values(FORMATS)) {
      const chosen = targetForSource(f.id);
      expect(
        targetsFor(f.id).map((t) => t.id),
        `${f.id} would render a select with an unlisted value`,
      ).toContain(chosen);
    }
  });
});
