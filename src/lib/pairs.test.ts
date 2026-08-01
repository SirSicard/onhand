import { describe, it, expect } from "vitest";
import { PAIRS, slugFor, titleFor } from "./pairs";
import { FORMATS, targetsFor } from "../engine/formats";

/**
 * The pair table is content, and content rots differently from code: nothing
 * throws when a page goes missing or two pages say the same thing. These are
 * the checks that would otherwise be someone noticing months later.
 */

describe("the pair table", () => {
  it("covers every conversion the engines actually offer", () => {
    const have = new Set(PAIRS.map((p) => `${p.source}>${p.target}`));
    const missing: string[] = [];
    for (const source of Object.values(FORMATS)) {
      for (const target of targetsFor(source.id)) {
        if (target.id === source.id) continue;
        if (!have.has(`${source.id}>${target.id}`)) missing.push(`${source.id} → ${target.id}`);
      }
    }
    // A reachable pair with no page means someone searching for exactly the
    // thing we can do lands on a competitor instead.
    expect(missing, "reachable conversions with no page").toEqual([]);
  });

  it("has no duplicate pairs", () => {
    const seen = new Map<string, number>();
    for (const p of PAIRS) {
      const key = `${p.source}>${p.target}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    // Two entries for one pair means getStaticPaths emits the same route twice,
    // which Astro resolves by silently keeping one — so the second reason is
    // written, committed, and never rendered.
    expect(dupes, "the same pair listed twice").toEqual([]);
  });

  it("gives every pair a unique slug", () => {
    const slugs = PAIRS.map(slugFor);
    expect(new Set(slugs).size, "two pairs collide on one URL").toBe(slugs.length);
  });

  it("says something specific on every page", () => {
    // The failure mode this guards is a templated reason: 148 pages that are
    // the same sentence with the nouns swapped, which is precisely what /why
    // criticises the incumbents for doing.
    const reasons = PAIRS.map((p) => p.reason);
    expect(new Set(reasons).size, "two pairs share a reason word for word").toBe(reasons.length);

    // Collect rather than assert per pair: a loop that throws on the first
    // offender means one rerun per thin sentence, which is how a batch of them
    // gets fixed one at a time over an afternoon.
    const thin = PAIRS.filter((p) => p.reason.length < 55).map(
      (p) => `${slugFor(p)} (${p.reason.length})`,
    );
    expect(thin, "reasons too short to say anything").toEqual([]);
    const unpunctuated = PAIRS.filter((p) => !p.reason.trim().endsWith(".")).map(slugFor);
    expect(unpunctuated, "reasons that are not sentences").toEqual([]);
  });

  it("ranks without ties, so the sitemap and the grid have a stable order", () => {
    const ranks = PAIRS.map((p) => p.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("never lists a pair the engines refuse", () => {
    for (const p of PAIRS) {
      expect(
        targetsFor(p.source).map((f) => f.id),
        `${titleFor(p)} has a page but is not reachable`,
      ).toContain(p.target);
    }
  });
});
