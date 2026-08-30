# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Violentmonkey/Tampermonkey userscript that enhances the Steam Inventory, Market and Trade
Offer pages. It is a hard fork of `Nuklon/Steam-Economy-Enhancer`, rebuilt from a single
4,805-line IIFE into TypeScript modules built by Vite.

**People run this against real money on the Steam market.** Refactors must not change
observable behaviour. When a change forces a behavioural choice, say so rather than deciding
quietly.

## Commands

```
pnpm install
pnpm build              # src/ -> dist/code.user.js
pnpm dev                # vite in watch mode

pnpm test               # vitest, all 25 files
pnpm vitest run test/pricing.test.ts          # one file
pnpm vitest run -t 'name of the test'         # one test by name
pnpm test:watch

pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint over src/ and test/
pnpm lint:dist          # userscript metadata rules, against the built artifact
pnpm format             # prettier (tabWidth 4)
pnpm format:check
```

CI runs typecheck, lint, format:check, test, build, the artifact-freshness check, then
lint:dist. All of them pass locally; keep it that way.

## The build, and why imports look the way they do

`userscript.config.ts` holds the `// ==UserScript==` metadata. `vite.config.ts` feeds it to
`vite-plugin-monkey`, which generates the header and bundles `src/main.ts`.

Five libraries — jQuery, async, localforage, luxon, list.js — are **`@require`d from a CDN,
not bundled**. Source imports them normally (`import $ from 'jquery'`); `externalGlobals`
in `userscript.config.ts` maps each specifier back to the window global its `@require` defines.
The packages are installed as devDependencies only so TypeScript can type them and
vite-plugin-monkey can resolve them — their versions are pinned to match the CDN URLs.

That mapping is also what makes `$.noConflict(true)` in `src/main.ts` safe: Rollup emits an
IIFE taking the globals as parameters, so jQuery is captured into a local binding before the
body runs, exactly as the original IIFE parameter did.

jQuery UI used to be a sixth. The script called exactly one of its widgets, `selectable`, and
paid 250KB over the wire for it; the inventory's click/Ctrl/Shift selection is now ~40 lines of
plain DOM code in `src/inventory/ui.ts` and no library at all. `@viselect/vanilla` was tried in
between and rejected: it put its listeners on `document`, where they competed with Steam's own,
and it does not cancel the default mousedown, so dragging the grid dragged the item icons. Both
were the cost of a rubber-band lasso this page does not need — and never showed, since jQuery
UI's stylesheet was never `@require`d either.

Two small unmaintained jQuery plugins are vendored under `src/vendor/` instead of `@require`d.
Do not edit those files; see `src/vendor/README.md`.

**`dist/code.user.js` is committed.** The raw GitHub URL is how people install the script, so
the artifact and the source must agree. Run `pnpm build` and commit the result with any change
to `src/`. CI fails on drift.

## Traps specific to this codebase

**Strict mode changed the rules.** The original was one sloppy-mode IIFE, where Annex B hoisted
function declarations out of `if` blocks up to function scope. An ES module is always strict,
where they are block-scoped. Porting the page-dispatch blocks naively caused the bundler to
delete 83 functions as unused while leaving the call sites intact. If you add a function
declaration inside a block and call it from outside, it will not be there.

**You cannot assign to an imported binding.** Shared mutable state is therefore held in objects
whose _properties_ are mutated: `src/totals.ts` (run totals) and `marketProgress` in
`src/market/progress.ts`. TypeScript catches violations as TS2632 — if you see it, the fix is an
object property or a setter, not a workaround. `setUserScrolled` in `src/ui/logger.ts` is the
setter form of the same problem.

**`src/steam/` has a deliberate layering.** `currency.ts` reads the wallet through
`steamPage.walletInfo()` rather than through the `market` singleton, even though they are the
same object, because that keeps it below `SteamMarket` in the import graph. The `market`
singleton lives beside its constructor in `steam/market.ts` because several prototype methods
call through the singleton rather than through `this`. Both arrangements exist to keep the graph
acyclic — don't "tidy" them without checking what cycle you create.

**`any` is confined to the Steam boundary.** `src/steam/globals.d.ts` documents it.
`createSteamPage(win: any)` is the one reach-in to `unsafeWindow`; everything downstream is
typed normally.

**`noImplicitAny` and `noUncheckedIndexedAccess` are off**, deliberately, and documented in
`tsconfig.json`. What is under `noImplicitAny` is ~255 parameters carrying Steam-shaped data
whose real shape is still an open question. Turn it on a module at a time as those shapes get
named; do not blanket-annotate them `any` to satisfy the flag.

## Architecture

`src/main.ts` exports one function, `bootstrap()`: the page-mode dispatch, the queue drain
registrations and the injected stylesheet. `src/entry.ts` — the Vite entry — calls it once.
Importing `main.ts` is inert apart from the jQuery handoff, which is what lets a test import
it without booting a page (`test/bootstrap.test.ts` pins that). The work lives in feature
modules:

- `steam/` — `page.ts` is the adapter over Steam's globals; `instance.ts` builds it once and
  decides which page this is; `market.ts` is the Steam Market API plus the singleton.
- `pricing/` — `fees.ts` is the fee arithmetic, `algorithms.ts` the four ways of choosing a
  price. Both take a `PricingRules` value rather than reading settings, the wallet and the
  clock themselves. That is what makes the numbers a user's items sell for testable.
- `queue/` — `runQueue` wraps `async.queue` with the escalating backoff and single forced
  retry every queue here needs. `nextQueueStep` is the pure decision, tested without a queue,
  a worker or a real clock.
- `inventory/`, `market/`, `tradeoffer/` — split by feature (sell, gems, boosters, relist,
  remove, sort…), because that is how failures get reported.
- `net/request.ts` — one request at a time, a delay between them, and a breaker that stops
  everything when Steam starts returning statuses that mean broken rather than busy. Its
  `transport` parameter is the seam that makes it testable.
- `items/`, `settings/`, `storage/`, `ui/`, `util/`, `constants.ts`, `totals.ts`.

### The steamPage seam

Reach-ins to Steam's globals used to happen at ~44 sites. They caused PR #334, where Steam
changed which element the sell listings header was and a naive lookup silently attached the
buttons to the wrong table — nothing threw, the buttons just stopped appearing.

There are now **two adapters over the same shape**, and they check each other:
`createSteamPage` (live, `src/steam/page.ts`) and `createFixtureSteamPage` (from data,
`test/steam-page-fixture.ts`). `test/steam-page-markup.test.ts` runs the live one against real
markup. If Steam's markup changes so the live lookup produces different inputs, the markup test
fails while the fixture keeps passing, and that disagreement is the signal. Keep both.

## Tests

vitest with happy-dom. jQuery, localforage, luxon, async and list.js all run **for real**; only
Steam's page globals and `$.ajax` are faked, in `test/fakes/`.

`test/setup.ts` installs the Steam page globals and replaces `$.ajax` with a recorder before
any test file runs, so a module that reaches for `unsafeWindow` or the network at import time
finds a fake rather than Steam. Test files import the module they exercise directly; only
`test/load.test.ts` imports `src/entry.ts`, which runs `bootstrap()`. Tests that need `request()` to do something inject their own
`transport`.

Assertions are `node:assert`, not vitest matchers. That was deliberate when the runner changed;
match the surrounding style rather than converting a file piecemeal.

`test/load.test.ts` is the cheapest guard against a broken import graph: it imports
`src/entry.ts`, which evaluates the whole module tree and runs `bootstrap()`.

## Verifying a refactor

Beyond the test suite, two checks catch what unit tests here cannot:

1. **Every function declared in `src/` must have a definition in `dist/code.user.js`** — a call
   site alone does not count. This is what catches the Annex B class of breakage.
2. **Every substantive line of the previous commit must still exist somewhere under `src/`.**
   Moving code between files is fine; losing it is not.

The 220 tests cover pricing, queues, requests, settings, item shapes, the page seam, the run
totals and market-progress lifecycles, the market row registry and button selection, the
inventory action pipeline and the quick-sell panel. They still do **not** drive the inventory
and market UI end to end, so changes there need the checks above and a careful read.

## Conventions

- Small atomic commits, one idea each. End the message with:
  `Claude-Session: <session URL>`
- Comments here explain _why_, often at length, and are load-bearing — when moving code, move
  the paragraph above it too.
- `.docs/` is untracked reference material from the architecture refactor. `MIGRATION.md` there
  records the migration decisions. Line references in the older files are pre-migration and no
  longer resolve.
- `master` tracks upstream and stays vanilla JavaScript; fixes intended for upstream are cut
  from there, not from this line.
