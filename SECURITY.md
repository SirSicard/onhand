# Security Policy

## Supported versions

Whatever is live at [onhand.pages.dev](https://onhand.pages.dev). It is a static
site with no accounts and no server-side state, so there is one version and it is
the current one. There are no backports because there is nothing to backport to.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Use GitHub's private vulnerability reporting on this repo: **Security tab →
Report a vulnerability**. It is private, it reaches the maintainer directly, and
it needs no email address to exist anywhere public.

That is the only channel, deliberately. A published address on a public
repository is scraped within days, and the GitHub route is both private and
easier to act on.

What to expect: acknowledgement within a few days, an honest assessment of
whether and when it will be fixed, and credit in the release notes unless you
would rather stay anonymous. No bounty — this project has no revenue.

## What counts as a vulnerability here

The threat model is unusual, because there is no server, no account, no session
and no stored user data. In practice the things that matter are:

**In scope, and taken seriously:**

- **Anything that causes file bytes to leave the browser.** This is the entire
  product promise. A dependency that phones home, a code path that POSTs, an
  error reporter that attaches file contents — all of it counts, however small.
- **Anything that defeats the `↑ 0 bytes uploaded` counter** while data is
  actually sent. The counter is a security control, not decoration.
- **Cross-origin isolation being lost**, since it is what keeps
  `SharedArrayBuffer` available and third-party resources out.
- **A malicious input file achieving code execution** through one of the wasm
  codecs. Please report it here _and_ upstream — the codecs are third-party.
- **Supply-chain concerns**: a dependency shipping something it shouldn't.

**Out of scope:**

- A malformed file crashing a conversion or exhausting memory. Files are
  attacker-controlled by design; a failed conversion in a sandboxed worker is a
  bug, not a vulnerability. Report it as an ordinary issue.
- Missing headers that only matter for sites with cookies or authentication.
  There are none of either.
- Anything requiring the attacker to already control the user's browser.

## Verifying the claim yourself

You do not have to trust any of this:

- Open DevTools → Network and convert a file. Nothing outbound carries a body.
- Disconnect from the network entirely. After one visit, conversions still work.
- CI fails the build if an external URL appears in the built output.
- The source is MIT and this repository is the whole of it.
