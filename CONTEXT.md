# Steam Economy Enhancer

A userscript that prices the items a user has listed on the Steam Market, compares each
listing to what the script thinks it should be worth, and offers to relist the ones that
are wrong. This glossary fixes the vocabulary for that comparison, because several of the
terms below name numbers that differ by small amounts and are easy to confuse.

## Language

### Prices

**Listed price**:
What a listing currently asks, inclusive of Steam's fees — the number the buyer pays.
_Avoid_: current price, my price, asking price

**Best price**:
What the script calculates the item should sell for, inclusive of fees and _excluding_ the
user's configured price offset. This is the reference point every comparison is made
against.
_Avoid_: calculated price, market price, fair price

**Seller proceeds**:
The part of the listed price that reaches the seller once Steam has taken its fee. Shown
to the user as "You get", both per listing and as a total.
_Avoid_: net price, take-home, seller price

**Relist price**:
The best price with the user's price offset applied — what a relist would actually list
the item at. It exists so that a user who deliberately undercuts is not relisted on every
pass; it is never the reference point for a comparison.
_Avoid_: offset price, target price, new price

### Comparison

**Verdict**:
How a listing's listed price compares to the best price: overpriced, underpriced, or fair.
An exact three-way comparison — one cent above the best price is overpriced.
_Avoid_: status, state, price check result

**Price delta**:
The signed amount by which the listed price differs from the best price. Positive means
the listing asks more than the best price; the sign always agrees with the verdict.
_Avoid_: difference, gap, spread, margin

### Talking to Steam

These three name the difference between a request that broke and a request Steam answered
with "no". The distinction had no name for two years, which is how `sellItem` came to
report a rejected listing as a completed one — see
`docs/adr/0002-steam-success-is-checked-on-sellitem-only.md`.

**Transport failure**:
The request did not complete: an HTTP error status, a timeout, a parse error, or the
breaker refusing to send. The action's outcome is _unknown_ — Steam may or may not have
performed it before the connection broke — which is why retrying one is unsafe.
_Avoid_: error, request error, network error

**Steam refusal**:
The request completed normally and Steam's response body says it declined to act. The
outcome is _known_: nothing happened, so a retry is safe. Only some endpoints report this
way, in a `success` field with an accompanying message.
_Avoid_: failure, rejection, bad response

**Retryable refusal**:
A Steam refusal whose message is one of the three known transient ones, such as "You cannot
sell any items until your previous action completes." Means _try again shortly_, as opposed
to a refusal that will fail identically however often it is repeated.
_Avoid_: temporary error, soft failure
