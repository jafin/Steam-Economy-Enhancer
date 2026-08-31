// Prints the derived version as `key=value` lines, which is the format GitHub Actions reads
// from $GITHUB_OUTPUT. Kept apart from version.ts so that file stays free of side effects --
// vite.config.ts imports it during every build, including the test run.
//
// Run with `node --experimental-strip-types scripts/print-version.ts`. The flag is needed on
// Node 22 and is a no-op from 23.6 onwards, where stripping is the default.

// A default import, not a named one: Node's JSON modules expose only the default export,
// where vite's transform would have allowed `import { version }`. This file runs under plain
// Node, so it takes Node's rule.
import pkg from '../package.json' with { type: 'json' };
import { versionFromGit } from './version.ts';

const derived = versionFromGit(pkg.version);

// A release build stamps the clean number; every other build stamps the -dev.N one.
const version = derived.release ? derived.releaseVersion : derived.version;

process.stdout.write(
    [
        `version=${version}`,
        `release=${derived.release}`,
        `tag=v${derived.releaseVersion ?? ''}`,
        `bump=${derived.bump ?? 'none'}`,
    ].join('\n') + '\n',
);
