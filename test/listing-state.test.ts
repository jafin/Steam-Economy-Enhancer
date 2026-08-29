import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

test('a listing that was never priced has no state', () => {
    const state = see.createListingState();

    assert.strictEqual(state.get('123'), undefined);
});

test('a listing keeps the price and verdict it was set with', () => {
    const state = see.createListingState();

    state.set('123', { sellPrice: 250, verdict: 'overpriced' });

    assert.deepStrictEqual(state.get('123'), { sellPrice: 250, verdict: 'overpriced' });
});

test('setting a listing again keeps the fields the second set leaves out', () => {
    const state = see.createListingState();

    state.set('123', { sellPrice: 250 });
    state.set('123', { verdict: 'fair' });

    assert.deepStrictEqual(state.get('123'), { sellPrice: 250, verdict: 'fair' });
});

test('listings do not share state', () => {
    const state = see.createListingState();

    state.set('123', { sellPrice: 250 });
    state.set('456', { sellPrice: 900 });

    assert.strictEqual(state.get('123').sellPrice, 250);
    assert.strictEqual(state.get('456').sellPrice, 900);
});

test('a listing id is the same key whether it arrives as a number or a string', () => {
    const state = see.createListingState();

    state.set(123, { sellPrice: 250 });

    assert.strictEqual(state.get('123').sellPrice, 250);
});

test('a listing asking more than the best price is overpriced', () => {
    assert.strictEqual(see.getListingVerdict(100, 150), 'overpriced');
});

test('a listing asking less than the best price is underpriced', () => {
    assert.strictEqual(see.getListingVerdict(150, 100), 'underpriced');
});

test('a listing asking the best price is fair', () => {
    assert.strictEqual(see.getListingVerdict(100, 100), 'fair');
});

test('a listing asking more than the best price has a positive delta', () => {
    const delta = see.getListingPriceDelta(233, 275);

    assert.strictEqual(delta.cents, 42);
    assert.ok(delta.percent > 0);
});

test('a listing asking less than the best price has a negative delta', () => {
    const delta = see.getListingPriceDelta(233, 200);

    assert.strictEqual(delta.cents, -33);
    assert.ok(delta.percent < 0);
});

test('a listing asking the best price has no delta', () => {
    assert.deepStrictEqual(see.getListingPriceDelta(233, 233), { cents: 0, percent: 0 });
});

// The choice of denominator is the decision recorded in ADR 0001, and it is invisible if
// it changes: the label still renders, it just quietly means something else. 42/233 is
// 18.0%, 42/275 is 15.3%, so this pins which one the percentage is.
test('the delta percentage is a fraction of the best price, not of the listed price', () => {
    const delta = see.getListingPriceDelta(233, 275);

    assert.strictEqual(delta.percent.toFixed(1), '18.0');
});

// A best price of zero makes the percentage infinite rather than large, so it is dropped
// and the caller renders the amount on its own.
test('a best price of zero leaves the delta without a percentage', () => {
    assert.deepStrictEqual(see.getListingPriceDelta(0, 275), { cents: 275, percent: null });
});

test('a positive delta is rendered with a plus sign', () => {
    assert.strictEqual(see.formatPriceDelta({ cents: 42, percent: 18 }), '+42 (+18.0%)');
});

test('a negative delta is rendered with a minus sign on both numbers', () => {
    assert.strictEqual(see.formatPriceDelta({ cents: -33, percent: -14.16 }), '−33 (−14.2%)');
});

// Being a single cent over the best price is the most common overpriced case. At zero
// decimal places it renders as (0%), which reads as a broken label rather than a small
// number.
test('a delta under one percent still renders a non-zero percentage', () => {
    assert.strictEqual(see.formatPriceDelta({ cents: 1, percent: 0.43 }), '+1 (+0.4%)');
});

test('a zero delta renders as nothing', () => {
    assert.strictEqual(see.formatPriceDelta({ cents: 0, percent: 0 }), '');
});

test('a delta with no percentage renders the amount alone', () => {
    assert.strictEqual(see.formatPriceDelta({ cents: 275, percent: null }), '+275');
});
