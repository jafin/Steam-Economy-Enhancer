// Values shared across the whole script, with no dependencies of their own.
//
// This module exists first in the split because everything else needs some of it: pulling
// the constants out up front means the modules that follow can depend on this rather than
// on each other, which is what keeps the import graph acyclic.

/** Which Steam page the script is running on. */
export const PAGE_MARKET = 0;
export const PAGE_MARKET_LISTING = 1;
export const PAGE_TRADEOFFER = 2;
export const PAGE_INVENTORY = 3;

export const COLOR_ERROR = '#8A4243';
export const COLOR_SUCCESS = '#407736';
export const COLOR_PENDING = '#908F44';
export const COLOR_PRICE_FAIR = '#496424';
export const COLOR_PRICE_CHEAP = '#837433';
export const COLOR_PRICE_EXPENSIVE = '#813030';
export const COLOR_PRICE_NOT_CHECKED = '#26566c';

// A listing is asking more than the best price, less than it, or exactly it. The names
// double as the class names the listings have always carried.
export const VERDICT_OVERPRICED = 'overpriced';
export const VERDICT_UNDERPRICED = 'underpriced';
export const VERDICT_FAIR = 'fair';

export const VERDICT_COLORS = {
    [VERDICT_OVERPRICED]: COLOR_PRICE_EXPENSIVE,
    [VERDICT_UNDERPRICED]: COLOR_PRICE_CHEAP,
    [VERDICT_FAIR]: COLOR_PRICE_FAIR,
};

export const VERDICT_MESSAGES = {
    [VERDICT_OVERPRICED]: 'Sell price is too high.',
    [VERDICT_UNDERPRICED]: 'Sell price is too low.',
    [VERDICT_FAIR]: 'Sell price is fair.',
};

// What a queue is doing with one inventory row, as a value rather than a colour picked
// at each of nine call sites: excluded from checking, waiting on a network call,
// finished, or failed.
export const ROW_STATUS_COLORS = {
    notChecked: COLOR_PRICE_NOT_CHECKED,
    pending: COLOR_PENDING,
    success: COLOR_SUCCESS,
    error: COLOR_ERROR,
};

export const ERROR_SUCCESS = null;
export const ERROR_FAILED = 1;
export const ERROR_DATA = 2;

// Retry timings shared by every queue. The values are the ones the queues used inline.
export const RETRY_DELAY_SHORT_MIN = 1000;
export const RETRY_DELAY_SHORT_MAX = 1500;
export const RETRY_DELAY_LONG_MIN = 30000;
export const RETRY_DELAY_LONG_MAX = 45000;
export const RETRY_FAILURES_BEFORE_RESET = 3;

export const enableConsoleLog = false;
