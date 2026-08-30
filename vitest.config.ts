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
            // src/entry.ts calls bootstrap(), which picks its page mode from location.href
            // and runs that page's dispatch on $(document).ready(). The market page is the
            // mode the old node --test harness used, and the one whose dispatch survives
            // having no real Steam page behind it. Only test/load.test.ts imports the entry;
            // every other test file imports the module it exercises directly.
            happyDOM: { url: 'https://steamcommunity.com/market/' },
        },
        include: ['test/**/*.test.ts'],
        setupFiles: ['test/setup.ts'],
    },
});
