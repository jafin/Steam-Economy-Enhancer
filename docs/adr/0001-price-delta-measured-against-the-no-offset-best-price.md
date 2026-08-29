# Price delta is measured against the no-offset best price

The market page shows how far each listing is from where it should be priced. Two prices
were available to measure that against: the **best price** (excluding the user's configured
price offset), which is what the existing verdict and its colour are computed from, and the
**relist price** (with the offset applied), which is what a relist would actually list the
item at. We measure against the best price.

## Considered Options

The relist price is the more directly actionable number — it answers "what would happen if
I hit relist?" — and it was a genuine candidate. It was rejected because the verdict, and
therefore the colour already on that cell, is computed from the best price. Measuring the
number against the offset price would put two different baselines on one row: a listing one
cent above the best price is coloured red, but against a negative offset the delta would
read something else entirely, and a user reading a red row next to `+€0.00` has no way to
tell which number is lying.

The relist price is not lost — it is surfaced in the cell's `title` tooltip alongside the
exact best price, where it answers its own question without redefining the label's.

## Consequences

The percentage uses the best price as its denominator for the same reason, so that the
overpriced and underpriced sides are measured from one fixed reference and two listings
equally far from the market always report the same magnitude.

Changing this baseline later is not a visible break — nothing throws and the label still
renders — it silently changes what every number on the page means. That invisibility is why
the decision is recorded here rather than left to be inferred from the division.
