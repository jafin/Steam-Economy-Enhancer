import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { resolve } from 'node:path';
import { version as pkgVersion } from './package.json' with { type: 'json' };
import { userscript, externalGlobals } from './userscript.config.ts';

// CI derives the version from the git tag (see .github/workflows/build.yml); local builds
// fall back to package.json. Userscript engines compare @version to decide whether to offer
// an update, so this number only ever goes up.
const version = process.env.APP_VERSION ?? pkgVersion;

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src'),
        },
    },
    build: {
        // Readable output: this file is committed and reviewed, and users install it by URL.
        minify: false,
        outDir: 'dist',
        emptyOutDir: false,
    },
    plugins: [
        monkey({
            entry: 'src/main.ts',
            userscript: { ...userscript, version },
            build: {
                fileName: 'code.user.js',
                // Maps each bare import to the window global its @require defines, so the six
                // CDN libraries are referenced rather than bundled. This is also what keeps
                // $.noConflict(true) safe -- see the note at the top of src/main.ts.
                externalGlobals,
            },
        }),
    ],
});
