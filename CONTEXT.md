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
The signed distance from the best price to the listed price, carried as both an amount and
a percentage of the best price. Positive means the listing asks more than the best price;
the sign always agrees with the verdict.
_Avoid_: difference, gap, spread, margin
