import type { APIRoute } from "astro";

/**
 * Everything is public and static, so everything is crawlable. There is no
 * user content, no account area and no search-result pages to keep out — the
 * usual reasons for a long robots file don't apply.
 */
export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL("https://onhand.pages.dev")).origin;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
