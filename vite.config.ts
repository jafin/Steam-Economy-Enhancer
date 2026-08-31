import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { resolve } from 'node:path';
import { version as pkgVersion } from './package.json' with { type: 'json' };
import { userscript, externalGlobals } from './userscript.config.ts';
import { versionFromGit } from './scripts/version.ts';

// The version is derived from the last tag and the conventional-commit messages since it --
// see scripts/version.ts for why the ordering matters. Every build derives it the same way,
// so a local `pnpm build` and a CI build at the same commit agree.
//
// APP_VERSION overrides it, and CI sets that on a release run: at the moment a release is
// cut, the build must stamp the clean 7.5.0 rather than the 7.5.0-dev.3 that this commit
// would otherwise carry.
//
// package.json's version is the base only until the first tag exists, since it is the one
// thing that knows where the numbering was before tagging started.
const version = process.env.APP_VERSION ?? versionFromGit(pkgVersion).version;

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
            entry: 'src/entry.ts',
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
