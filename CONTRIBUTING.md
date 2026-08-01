# Contributing to Onhand

Onhand is free, MIT licensed and maintained by one person. Contributions are
welcome, and so is a good bug report.

## Reporting bugs

- Search [existing issues](https://github.com/SirSicard/onhand/issues) first.
- Say **which browser and version**. This matters more here than in most
  projects: the conversion path genuinely differs between Chrome, Firefox and
  Safari, and "works for me" often means "my browser has an AAC encoder".
- Say **which conversion** — the source format and the target, not just "video".
- If a file failed, say **how big it was and roughly what produced it** (an
  iPhone, a screen recorder, Premiere). Container quirks are usually the cause.
- Open the console and paste what's there. Errors here carry a human sentence
  and often name the actual problem.
- **Please don't attach the file itself** unless you're certain you're happy
  making it public. Issues are public. A description of the file is nearly
  always enough, and if it isn't I'll ask.

## Suggesting features

Open an issue describing the problem, not just the solution. Some things are
deliberately out of scope and saying so early saves us both time:

- **Anything that uploads.** No server-side fallback for hard formats, no
  "just for large files" exception. The whole product is the absence of that.
- **Analytics**, in any form, however anonymised.
- **Accounts, sign-in, or a paid tier.**
- **Office documents** (docx/xlsx/pptx) — see the README's limits section. Not
  refused on principle, just not currently possible at a sane download size.

## Working on the code

```bash
pnpm install
pnpm dev            # localhost:4321
pnpm test           # node: pure logic
pnpm test:browser   # chromium: the real conversion matrix
pnpm test:browser:all   # all three browsers — slower, run before a PR
pnpm typecheck
pnpm lint
```

A few things worth knowing before you spend an evening on something:

**Conversion tests run in a real browser.** Mocking a wasm codec tests the mock.
If you add a format or a pair, add it to the matrix in
`src/engine/matrix.browser.test.ts` and to the corpus — `src/engine/corpus.test.ts`
will fail if a decodable format has no fixture, which is deliberate.

**Assert on decoded output, not on bytes existing.** An encoder that returns a
valid, empty image passes the lazy version of every test in this repo.

**Use `pnpm build`, never `astro build`.** The pre/post hooks copy and gzip the
ffmpeg core and generate the service worker. Skipping them produces a site whose
audio conversions 404, with no error to explain it.

**Formats are declared in one place.** `src/engine/formats.ts` is the single
source of truth; the UI, the offline check and the pair pages all derive from
it. If you find yourself maintaining a second list of the same fact, that's the
bug — there is already a comment in there explaining how that went last time.

**Comments explain why, not what.** The interesting content in this codebase is
the reasoning, usually about a failure mode that isn't obvious. If you fix
something subtle, leave the next person the sentence you wish you'd had.

## Pull requests

- One thing per PR.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:browser` before pushing.
  CI runs all of it and will tell you anyway, but the loop is faster locally.
- If it changes behaviour, it needs a test that fails without the change. The
  most useful ones in this repo were written by reintroducing the bug and
  confirming the test caught it.

## Security

Not here — see [SECURITY.md](SECURITY.md). Use GitHub's private vulnerability
reporting rather than a public issue.
