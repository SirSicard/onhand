# What I need from you, by phase

Everything else I can do myself. This is only the list of things that need your
account, your money, or your call.

Status: P0–P3 shipped. P4 next.

---

## Now — unblocks automatic deploys

**1. Cloudflare Pages ← GitHub.** _(you said you're on this)_

Two ways, and they are not equivalent:

- **Connect the Pages project to the repo** in the CF dashboard. Deploys happen
  on push, **and you get preview deploys per PR** — which the plan wanted and
  Direct Upload cannot do. Set the build command to `pnpm build` (not
  `astro build` — the `prebuild` hook is what copies and gzips the ffmpeg core).
- Or **add two repository secrets** and let `.github/workflows/deploy.yml` do it:
  `CLOUDFLARE_API_TOKEN` (needs _Cloudflare Pages: Edit_) and
  `CLOUDFLARE_ACCOUNT_ID` = `e677ec872dea666fd3cd743630c6a88f`.

The first is better. The workflow is a fallback, not the goal.

---

## P4 — PWA + polish

**2. Is Onhand installable, or just offline-capable?** Installable means a
manifest, icons at 6 sizes, and an install prompt. Offline-capable means it
keeps working in airplane mode without pretending to be an app. I'd do
offline-capable only — an install prompt on a tool people use twice a year is
noise. Say if you disagree.

**3. Do you want a designed mark?** There is a placeholder `favicon.svg`. I can
generate something serviceable, but if you want Onhand to look like a product
rather than a project, that is a you-or-a-designer job. Needed for: favicon, OG
image, the empty state.

**4. The airplane-mode GIF.** The plan leads the launch with it. I can produce
the recording, but a screen capture of your machine going offline and the thing
still working is more convincing than anything I can synthesise. Your call who
makes it.

---

## P5 — pages, SEO, launch

**5. Domain — the big one.** Everything is on `onhand.pages.dev`. Two hundred
SEO pages pointing at a domain we later abandon is two hundred wasted pages, so
this wants deciding **before** P5, not during. Do you want to buy one, and
which? (`onhand.app` reads best to me; `.com` is likely taken by something.)
Tell me the domain and I'll wire it — or tell me to stay on `pages.dev` and I'll
stop asking.

**6. Repo public or private?** Currently **private**. This is not cosmetic:

- The footer says "read the code" and the whole pitch is that you can verify
  nothing is uploaded. A private repo makes that claim unverifiable.
- It also matters legally — see item 7.

Plan said "flip to public when P1 renders something". P3 is live. I'd flip it.

**7. ffmpeg is GPL. Our code is MIT. This needs a decision before launch.**

`@ffmpeg/core` declares `GPL-2.0-or-later`. We host and serve that binary
ourselves. Our own code is MIT and talks to it across a worker boundary, which
is the ordinary "separate component" posture — the same thing every app that
ships an ffmpeg binary relies on. I am not a lawyer, and this is the one item
here where being wrong is expensive.

The options as I see them:

- **(a) Keep MIT, go public, document it.** `THIRD_PARTY.md` states the core is
  GPL-2.0-or-later, links upstream source, and makes clear it is a separate
  downloaded component. Standard industry position. **My recommendation.**
- **(b) Use an LGPL ffmpeg build** (no `--enable-gpl`, so no libx264). Cleaner
  licence story, but **we lose H.264 encoding on the ffmpeg path — which is
  exactly the Firefox mov→mp4 fallback.** Real product cost for a legal
  nicety we probably don't need.
- **(c) Ship it and stay private.** Muddiest. Don't.

Tell me (a), (b), or get an actual opinion from someone qualified.

**8. Launch accounts.** Show HN, r/privacy, r/degoogle, Product Hunt. I draft,
you post — I'm not posting under your name.

**9. Keyword data, if you have it.** I can rank ~200 format pairs from the
incumbents' sitemaps and judgement. If you have Ahrefs/Semrush, real search
volume beats my guess and takes ten minutes.

---

## Confirm, so I don't build the wrong thing

**10. Zero analytics — still true?** Spec says no telemetry, and it's a
differentiator. But launches usually want numbers, and "how many people used
it" is a reasonable thing to want. If you want any, say so now; retrofitting
analytics into a page whose headline promise is "nothing is uploaded" is a
conversation I'd rather have once.

**11. A contact route?** No email, no form anywhere right now. Fine for a tool
with no accounts, but bug reports have nowhere to go except GitHub issues —
which needs the repo public.

---

## Not on your list

I don't need anything from you for: the PWA service worker, offline caching,
Lighthouse work, pair-page generation, the `/formats` matrix, the `/why`
manifesto, `THIRD_PARTY.md`, sitemap/robots, OG image generation, or the README
measurements. Those are mine.
