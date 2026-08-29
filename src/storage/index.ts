// Wrappers over the browser's own storage.
//
// Both are wrapped because a browser can refuse them outright -- private mode, disabled
// site data, storage quota -- and a throw from a settings read would take the whole script
// down on page load. Failing soft and logging is the existing behaviour.

import { logConsole } from '../ui/logger.ts';

export function getLocalStorageItem(name) {
    try {
        return localStorage.getItem(name);
    } catch (e) {
        logConsole(`Failed to get local storage item ${name}, ${e}.`);
        return null;
    }
}

export function setLocalStorageItem(name, value) {
    try {
        localStorage.setItem(name, value);
        return true;
    } catch (e) {
        logConsole(`Failed to set local storage item ${name}, ${e}.`);
        return false;
    }
}

export function getSessionStorageItem(name) {
    try {
        return sessionStorage.getItem(name);
    } catch (e) {
        logConsole(`Failed to get session storage item ${name}, ${e}.`);
        return null;
    }
}

export function setSessionStorageItem(name, value) {
    try {
        sessionStorage.setItem(name, value);
        return true;
    } catch (e) {
        logConsole(`Failed to set session storage item ${name}, ${e}.`);
        return false;
    }
}
