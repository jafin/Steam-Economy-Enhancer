// Escaping for the few places this script builds HTML from Steam's own strings.
//
// Item names are not ours and not trusted: on a trade offer page the names on the 'them'
// side are written by whoever sent the offer, and name tags in TF2/CS2 and Workshop items
// make that reachable by a stranger. Steam escapes them in its own rendering; a template
// literal fed to .append() or innerHTML does not.
export function escapeHtml(value: unknown): string {
    return String(value).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
}
