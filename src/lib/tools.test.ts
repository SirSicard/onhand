import { describe, it, expect } from "vitest";
import { TOOLS } from "./tools";
import { PAIRS } from "./pairs";
import { targetsFor } from "../engine/formats";

describe("the tool pages", () => {
  it("links only to pair pages that exist", () => {
    const known = new Set(PAIRS.map((p) => `${p.source}>${p.target}`));
    const dead = TOOLS.flatMap((t) =>
      t.pairs.filter(([s, x]) => !known.has(`${s}>${x}`)).map(([s, x]) => `${t.slug}: ${s} → ${x}`),
    );
    expect(dead, "tool pages linking to conversions with no page").toEqual([]);
  });

  it("preselects a target the sources can actually reach", () => {
    // A tool page that mounts the converter with a target none of its own pairs
    // can produce would silently fall back to the default, so the preselection
    // would appear to work and quietly do nothing.
    for (const tool of TOOLS) {
      if (!tool.target) continue;
      for (const [source] of tool.pairs) {
        expect(
          targetsFor(source).map((f) => f.id),
          `${tool.slug} preselects ${tool.target}, unreachable from ${source}`,
        ).toContain(tool.target);
      }
    }
  });

  it("has a distinct slug, title and description per tool", () => {
    for (const key of ["slug", "title", "metaTitle", "description"] as const) {
      const values = TOOLS.map((t) => t[key]);
      expect(new Set(values).size, `two tools share a ${key}`).toBe(values.length);
    }
  });

  it("says enough to be worth a page", () => {
    for (const tool of TOOLS) {
      expect(tool.intro.length, `${tool.slug} has no intro`).toBeGreaterThan(0);
      expect(tool.points.length, `${tool.slug} has fewer than three points`).toBeGreaterThanOrEqual(
        3,
      );
      expect(tool.pairs.length, `${tool.slug} links nothing`).toBeGreaterThan(0);
      // Meta descriptions over ~160 characters get truncated in results, and a
      // sentence cut mid-word is worse than a shorter one.
      expect(tool.description.length, `${tool.slug}'s meta description is too long`).toBeLessThan(
        200,
      );
    }
  });

  it("does not reuse a point verbatim across tools", () => {
    // The tell for a templated page. If two intent pages need the same
    // paragraph, one of them probably should not exist.
    const bodies = TOOLS.flatMap((t) => t.points.map((p) => p.body));
    expect(new Set(bodies).size, "two tools share a paragraph word for word").toBe(bodies.length);
  });
});
