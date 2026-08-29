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

export function padLeftZero(str, max): string {
    str = str.toString();
    return str.length < max ? padLeftZero(`0${str}`, max) : str;
}

export function replaceNonNumbers(str) {
    return str.replace(/\D/g, '');
}
