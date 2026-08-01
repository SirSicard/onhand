import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import axe from "axe-core";
import Converter from "./Converter";

/**
 * The queue UI, driven the way a person drives it.
 *
 * Rendered into a real browser rather than jsdom: the drop zone, the file
 * input, focus order and axe's colour-contrast checks all need real layout to
 * mean anything. jsdom would report a clean pass on a page nobody could use.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => root.render(<Converter />));
}

/** A tiny but genuinely valid PNG, so detection and conversion both work. */
function pngFile(name: string): File {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

function addFiles(files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

const rows = () => Array.from(container.querySelectorAll("li"));
const buttonNamed = (re: RegExp) =>
  Array.from(container.querySelectorAll("button")).find((b) => re.test(b.textContent ?? ""));

describe("queue mechanics", () => {
  it("adds a dropped file and picks a sensible target", () => {
    render();
    addFiles([pngFile("photo.png")]);

    expect(rows()).toHaveLength(1);
    // The row's picker, not the global "Convert all to" — that one is
    // deliberately valueless so it reads as an action rather than a state.
    const select = rows()[0]!.querySelector("select")!;
    // PNG defaults to WebP: the usual intent is "make this smaller for the web".
    expect(select.value).toBe("webp");
  });

  it("disambiguates two files that would produce the same name", () => {
    render();
    addFiles([pngFile("photo.png"), pngFile("photo.png")]);

    const names = rows().map((li) => li.querySelector("span")!.textContent);
    expect(names).toEqual(["photo.png", "photo (2).png"]);
  });

  it("removes a row without touching the others", () => {
    render();
    addFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    expect(rows()).toHaveLength(3);

    const remove = rows()[1]!.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!;
    act(() => remove.click());

    expect(rows().map((li) => li.querySelector("span")!.textContent)).toEqual(["a.png", "c.png"]);
  });

  it("offers only targets reachable from every queued file", () => {
    render();
    addFiles([pngFile("a.png")]);
    // With one PNG queued, "Convert all to" must not offer MP3.
    const selects = Array.from(container.querySelectorAll("select"));
    const global = selects.find((s) =>
      Array.from(s.options).some((o) => /Convert all to/.test(o.textContent ?? "")),
    );
    if (global) {
      const ids = Array.from(global.options).map((o) => o.value);
      expect(ids).not.toContain("mp3");
      expect(ids).not.toContain("mp4");
    }
  });

  it("does not offer an impossible target on the per-row picker", () => {
    render();
    addFiles([pngFile("a.png")]);
    const ids = Array.from(rows()[0]!.querySelector("select")!.options).map((o) => o.value);
    expect(ids).not.toContain("mp3");
    expect(ids).toContain("pdf");
  });
});

describe("the upload counter", () => {
  it("reads zero, which is the entire promise", () => {
    render();
    addFiles([pngFile("a.png")]);
    // Match the counter itself, not the drop-zone copy — which also contains
    // the word "uploaded", and is the first span in the document.
    const counter = Array.from(container.querySelectorAll("span")).find((s) =>
      /^↑ /.test(s.textContent ?? ""),
    );
    expect(counter?.textContent).toBe("↑ 0 bytes uploaded");
  });
});

describe("keyboard operation", () => {
  it("exposes the drop zone as a real, focusable control", () => {
    render();
    // A real <button>, not a div with role="button" — the latter cannot legally
    // contain the file input, and screen readers disagree about what it is.
    const zone = buttonNamed(/Drop anything/)!;
    expect(zone.tagName).toBe("BUTTON");
    zone.focus();
    expect(document.activeElement).toBe(zone);
  });

  it("gives every control an accessible name", () => {
    render();
    addFiles([pngFile("a.png")]);

    for (const el of container.querySelectorAll("button, select, input")) {
      const name =
        el.getAttribute("aria-label") ??
        el.textContent?.trim() ??
        (el.id ? container.querySelector(`label[for="${el.id}"]`)?.textContent : null);
      expect(name, `${el.tagName} has no accessible name: ${el.outerHTML.slice(0, 80)}`).toBeTruthy();
    }
  });

  it("reaches every control in tab order", () => {
    render();
    addFiles([pngFile("a.png")]);
    const focusable = container.querySelectorAll(
      'button:not([disabled]), select:not([disabled]), [tabindex="0"]',
    );
    expect(focusable.length).toBeGreaterThan(3);
    for (const el of focusable) {
      (el as HTMLElement).focus();
      expect(document.activeElement, `could not focus ${el.tagName}`).toBe(el);
    }
  });
});

describe("accessibility", () => {
  async function violations(impacts: string[]) {
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      // Landmark/region rules judge a whole page; this mounts one component.
      rules: { region: { enabled: false } },
    });
    return results.violations.filter((v) => impacts.includes(v.impact ?? ""));
  }

  it("has no critical or serious violations in the zero state", async () => {
    render();
    const found = await violations(["critical", "serious"]);
    expect(
      found.map((v) => `${v.id}: ${v.nodes[0]?.failureSummary?.split("\n")[0]}`),
      "axe violations",
    ).toEqual([]);
  }, 60_000);

  it("has no critical or serious violations with a populated queue", async () => {
    render();
    addFiles([pngFile("a.png"), pngFile("b.png")]);
    // Open the advanced panel too — a disclosure nobody opens in tests is a
    // disclosure nobody checks.
    const adv = buttonNamed(/Advanced/);
    if (adv) act(() => adv.click());

    const found = await violations(["critical", "serious"]);
    expect(
      found.map((v) => `${v.id}: ${v.nodes[0]?.failureSummary?.split("\n")[0]}`),
      "axe violations",
    ).toEqual([]);
  }, 60_000);
});

describe("presets", () => {
  it("marks the active preset with aria-pressed, not colour alone", () => {
    render();
    addFiles([pngFile("a.png")]);

    const balanced = buttonNamed(/^Balanced$/)!;
    const smallest = buttonNamed(/^Smallest$/)!;
    expect(balanced.getAttribute("aria-pressed")).toBe("true");

    act(() => smallest.click());
    expect(smallest.getAttribute("aria-pressed")).toBe("true");
    expect(balanced.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers Lossless", () => {
    render();
    addFiles([pngFile("a.png")]);
    expect(buttonNamed(/^Lossless$/)).toBeTruthy();
  });

  it("says so when Lossless cannot be honoured by the chosen format", () => {
    render();
    addFiles([pngFile("a.png")]); // defaults to WebP, which is lossy
    act(() => buttonNamed(/^Lossless$/)!.click());
    expect(container.textContent).toMatch(/lossy format/i);
  });
});

describe("AC-P3: a mixed batch, driven by keyboard alone", () => {
  /** Fetch real fixtures so this converts genuine files, not synthetic stubs. */
  async function fixture(name: string): Promise<File> {
    const res = await fetch(`/fixtures/${name}`);
    if (!res.ok) throw new Error(`fixture ${name} missing (${res.status})`);
    const buf = await res.arrayBuffer();
    const head = new TextDecoder().decode(buf.slice(0, 64));
    if (/^\s*<!doctype html|^\s*<html/i.test(head)) {
      throw new Error(`fixture ${name} was served as HTML, not file bytes`);
    }
    return new File([buf], name);
  }

  /**
   * Find a keyboard-reachable control and focus it.
   *
   * `selector` matters: a <select>'s textContent is the concatenation of its
   * options, so "Convert all to…" matches /^Convert/ and shadows the Convert
   * button. Matching on text alone silently grabs the wrong control and the
   * test then fails for a reason that has nothing to do with the app.
   */
  function tabTo(match: RegExp, selector = "button:not([disabled])"): HTMLElement {
    const stops = Array.from(container.querySelectorAll<HTMLElement>(selector));
    const target = stops.find(
      (el) => match.test(el.textContent ?? "") || match.test(el.getAttribute("aria-label") ?? ""),
    );
    if (!target) throw new Error(`no keyboard-reachable control matching ${match}`);
    target.focus();
    if (document.activeElement !== target) throw new Error(`${match} could not take focus`);
    return target;
  }

  it("converts ten mixed files without a single mouse click", async () => {
    render();

    const names = [
      "photo.png", "photo.jpg", "photo.heic", "photo.webp", "photo.bmp",
      "graphic-alpha.png", "icon.ico", "vector.svg", "tiny-1x1.png", "photo.tiff",
    ];
    addFiles(await Promise.all(names.map(fixture)));
    expect(rows()).toHaveLength(10);

    // Pick a preset by keyboard.
    const smallest = tabTo(/^Smallest$/);
    act(() => smallest.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(smallest.getAttribute("aria-pressed")).toBe("true");

    // Start the batch by keyboard.
    const convert = tabTo(/^Convert/);
    await act(async () => {
      convert.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Wait for every row to settle.
    const deadline = performance.now() + 120_000;
    for (;;) {
      const text = container.textContent ?? "";
      const settled = (text.match(/→/g) ?? []).length;
      if (settled >= 10 || performance.now() > deadline) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 250));
      });
    }

    // Every row shows a size delta, which only a completed conversion produces.
    const deltas = (container.textContent ?? "").match(/→/g) ?? [];
    expect(deltas.length, `only ${deltas.length}/10 finished`).toBe(10);

    // And nothing left the device.
    const counter = Array.from(container.querySelectorAll("span")).find((s) =>
      /^↑ /.test(s.textContent ?? ""),
    );
    expect(counter?.textContent).toBe("↑ 0 bytes uploaded");

    // "Download all" appears and is reachable by keyboard.
    expect(tabTo(/Download all/).tagName).toBe("BUTTON");
  }, 180_000);
});
