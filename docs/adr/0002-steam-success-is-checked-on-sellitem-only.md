# Steam's success field is checked on sellitem only

`SteamMarket` wraps five endpoints that change something: `sellItem`, `removeListing`,
`getGooValue`, `grindIntoGoo` and `unpackBoosterPack`. All five reported success on any HTTP
success, whatever the response body said. `inventory/sell.ts` compensated by re-checking
`data.success` itself; `market/relist.ts` calls the same `sellItem` and did not, so a listing
Steam rejected with a `200` was painted green and then removed from the page — leaving the
item in the user's inventory, delisted and unrelisted.

The obvious repair is to have every mutating method check `success`. That repair is wrong,
and the reason is not visible from the code.

Both this branch and the vanilla `master` mirror of upstream were searched, 356 commits of
`code.user.js`. `/market/sellitem/` does return `success` and `message`, and has been checked
continuously since 2019 — the check lived _inside_ `sellItem` until `0bb6399` moved it out to
the sell queue worker during a rewrite onto `request()`. Price history, order book and
`/market/mylistings` also check it, and always have. But for `removelisting`,
`cancelbuyorder`, `ajaxgrindintogoo`, `ajaxunpackbooster` and `ajaxgetgoovalue`, no version of
this codebase has ever read a `success` field. The refactor did not drop those checks; there
were none to drop. No `success` field has ever been compared to a number in either branch,
and there are no EResult constants anywhere.

So for those endpoints we have an absence of evidence, not evidence of absence. We do not
know whether Steam sends the field there. We know only that nothing has ever looked.

**`sellItem` checks `success`. The other four do not.** The uniform parts of the convention —
one sentinel set, `ERROR_DATA` meaning Steam declined, consistent callback arity — apply to
all ten methods, because those are behaviour-preserving at every call site. Only the `success`
translation is narrowed.

## Considered Options

Checking `success` on all five was the original proposal and is what an architecture review
recommended before this history was read. It would break the four unchecked paths if their
bodies carry no such field: `!data.success` on an absent field is `true`, so every successful
grind, unpack and delisting would be reported as a failure. That is a worse regression than
the defect being fixed, and one that appears only during a live market run against real money.

The strict predicate `data.success === false` was the better version of that idea, and is
close to what the 2019 code used. Absent means success, so endpoints without the field are
unaffected by construction, and the check could be applied everywhere safely. It was rejected
because with `sellItem` as the only subject it buys uniformity that no other method can yet
use, while quietly changing the semantics `inventory/sell.ts` has run in production for years:
that caller uses truthiness, so a `success: 0` would flip from failure to success. Matching
the proven behaviour of the one endpoint we have evidence for mattered more.

Callers of the four unchecked methods lose nothing by this. If those bodies carry no refusal
signal, then reporting success on any `200` is already the correct answer, and there is
nothing for a caller to guess at.

## Consequences

The convention is not uniform, and reads as an oversight to anyone looking only at the code.
That is what this file is for; a comment beside each unchecked method points here. Do not
tidy it into a uniform check without new evidence — the recommendation to do so has already
been made once, on this same evidence, before the history was read.

If one of those four endpoints does report refusals in its body, we still swallow them. That
exposure is unchanged from before this decision rather than introduced by it.

The way to settle it is to log the raw response body on those paths during a real session and
record what comes back. If the field is there, extend the check to that method using the same
predicate as `sellItem` and amend this file. If it is not, record that too — "no `success`
field observed" is the sentence that stops the next reader having this argument again.

`market/listings.ts` and `market/relist.ts` each read a `success` field as well. Both are
outside `SteamMarket` — a direct `request()` call and a `steamPage` inventory transport — and
are deliberately out of scope here.
