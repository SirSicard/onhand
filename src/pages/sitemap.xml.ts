import type { APIRoute } from "astro";
import { PAIRS, slugFor } from "@/lib/pairs";

/**
 * Hand-rolled rather than @astrojs/sitemap, because the priority is not
 * uniform: the pair pages are ranked, and that ranking is the one piece of
 * information a generic integration cannot know.
 */
export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL("https://onhand.pages.dev")).origin;

  // Trailing slashes throughout, matching what Astro emits and what each page
  // declares as its canonical. Without them every entry is a 308 hop.
  const urls = [
    { loc: "/", priority: "1.0", changefreq: "weekly" },
    { loc: "/formats/", priority: "0.8", changefreq: "monthly" },
    { loc: "/why/", priority: "0.7", changefreq: "monthly" },
    ...PAIRS.map((pair) => ({
      loc: `/${slugFor(pair)}/`,
      // Ranked pairs get ranked priority, tapering from 0.9 down to 0.4. A
      // sitemap where everything is 1.0 conveys nothing.
      priority: Math.max(0.4, 0.9 - (pair.rank - 1) * 0.012).toFixed(2),
      changefreq: "monthly",
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${origin}${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
