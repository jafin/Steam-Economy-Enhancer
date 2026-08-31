// Small numeric helpers.
//
// These lived under a region called 'Integer helpers' which also housed the entire queue
// retry machinery -- the region name described about a quarter of its contents. The queue
// code moves to src/queue/; what remains here really is integer helpers.

export function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getNumberOfDigits(x) {
    return (Math.log10((x ^ (x >> 31)) - (x >> 31)) | 0) + 1;
}

// Pads to a minimum width; never truncates. The recursion this replaces prepended one '0'
// per call and compared length after coercing, which is exactly padStart's contract for a
// non-negative `max` -- and for a negative one both leave the string alone.
export function padLeftZero(str, max): string {
    return String(str).padStart(max, '0');
}

export function replaceNonNumbers(str) {
    return str.replace(/\D/g, '');
}

// Groups a whole number in threes: 1284 -> '1,284'.
//
// Not toLocaleString(). The separator that returns depends on the machine's locale rather
// than on anything the user chose here, so the same count renders differently on two
// browsers looking at the same page -- and in a test, differently on two CI runners. One
// predictable rendering everywhere, for the same reason formatPriceDelta applies its own
// sign instead of asking Steam's formatter for one.
export function formatCount(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
