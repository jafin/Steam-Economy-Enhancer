# Vendored jQuery plugins

Both plugins were previously loaded as `@require` URLs pointing at
`raw.githubusercontent.com`. GitHub does not support that host as a CDN — it
serves `text/plain`, is rate limited, and can be withdrawn — and both were
already pinned to a commit SHA, so no upstream updates were being picked up.
They are small, unmaintained, and MIT licensed, so they are vendored here and
bundled instead. Types live in `vendor.d.ts`.

| File | Upstream | Commit | Licence |
|---|---|---|---|
| `jquery-observe.js` | https://github.com/kapetan/jquery-observe | `ca67b735bb3ae8d678d1843384ebbe7c02466c61` | MIT, © 2012 Mirza Kapetanovic |
| `jquery.checkboxes.js` | https://github.com/rmariuzzo/checkboxes.js | `91bec667e9172ceb063df1ecb7505e8ed0bae9ba` | MIT, © 2016 Rubens Mariuzzo |

`jquery-observe.js` is vendored in the minified form its repository publishes;
there is no unminified build at that commit. Neither file carried its licence
notice inline, so a header was prepended to each. Do not edit either file — to
update, re-fetch from the pinned URL and re-apply the header.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
