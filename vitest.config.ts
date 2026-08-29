import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src'),
        },
    },
    test: {
        environment: 'happy-dom',
        environmentOptions: {
            // src/main.ts picks its page mode from location.href at import time and then
            // runs that page's bootstrap on $(document).ready(). The market page is the
            // mode the old node --test harness used, and the one whose bootstrap survives
            // having no real Steam page behind it.
            happyDOM: { url: 'https://steamcommunity.com/market/' },
        },
        include: ['test/**/*.test.ts'],
        setupFiles: ['test/setup.ts'],
    },
});
