// The on-page log.
//
// Userscripts share the host page's console, so an unprefixed console.log is impossible to
// attribute. This script writes instead to a log element it injects into the inventory
// page, and keeps it scrolled to the bottom unless the user has scrolled up to read
// something.

import { enableConsoleLog } from '../constants.ts';

/**
 * The log element itself, injected into the inventory page by the inventory UI.
 *
 * Built at module load and left detached on every other page, which is why logDOM has to
 * cope with there being nothing to write to.
 */
export const logger = document.createElement('div');
logger.setAttribute('id', 'logger');

// Whether the user has scrolled up to read something. While they have, new lines must not
// yank the view back down to the bottom.
let userScrolled = false;

/**
 * Called by the inventory UI's scroll handler.
 *
 * A setter rather than an exported `let`, because an imported binding cannot be assigned
 * to from another module.
 */
export function setUserScrolled(value: boolean): void {
    userScrolled = value;
}

// The logger is only attached to the page on the inventory page, so on every other page
// there is nothing to scroll. logDOM is reachable from those pages, most importantly from
// the request breaker, and throwing here would abandon whatever called it.
export function updateScroll() {
    if (userScrolled) {
        return;
    }

    const element = document.getElementById('logger');
    if (element == null) {
        return;
    }

    element.scrollTop = element.scrollHeight;
}

export function logDOM(text) {
    logger.innerHTML += `${text}<br/>`;

    updateScroll();
}

export function logConsole(text) {
    if (enableConsoleLog) {
        console.log(text);
    }
}
