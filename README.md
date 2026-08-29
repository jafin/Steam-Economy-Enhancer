# <img src="assets/icon.svg" width="32" align="center"> Steam Economy Enhancer

A free userscript to enhance your Steam Inventory, Steam Market and Steam Tradeoffers.

This is a fork of [Nuklon/Steam-Economy-Enhancer](https://github.com/Nuklon/Steam-Economy-Enhancer),
rebuilt as a TypeScript project. It installs and updates separately from upstream, so you can
run either — but not both at once, since they modify the same pages.

It adds the following features to the Steam Market:

- Detect overpriced and underpriced items.
- Select 5/25/all (overpriced) items and remove them at once.
- (Automatically) relist overpriced items.
- Sort and search items by name, price or date.
- Total price for listings, as seller and buyer.

It adds the following features to the Steam Inventory:

- Sell all (selected) items or trading cards automatically.
- Select multiple items simultaneously with _Shift_ or _Ctrl_.
- Market sell and buy listings added to the item details.
- Quick sell buttons to sell an item without confirmations.
- Shows the lowest listed price for each item.
- Turn selected items into gems.
- Unpack selected booster packs.

It adds the following features to the Steam Tradeoffers:

- A summary of all items from both parties that includes total number of items, number of unique items and item count breakdown (how many of each item there are)
- Select all items of the current page.
- Shows the lowest listed price for each inventory item.

The pricing can be based on the lowest listed price, the price history and your own minimum and maximum prices.
This can be defined in Steam Economy Enhancer's settings, which you can find at the top of the page near the _Install Steam_ button.

> [!NOTE]
> It is free but there is **NO** support. If you want to add functionality, feel free to submit a PR.

### Download

[Install Steam Economy Enhancer](https://raw.githubusercontent.com/jafin/Steam-Economy-Enhancer/master/dist/code.user.js)

_[Violentmonkey](https://violentmonkey.github.io/) is required to install._

Tagged releases are also published on the
[releases page](https://github.com/jafin/Steam-Economy-Enhancer/releases).

### Building from source

The script is built from TypeScript sources under `src/` into a single userscript.

```
pnpm install
pnpm build      # writes dist/code.user.js
```

`dist/code.user.js` is committed, because the raw GitHub URL above is how people install the
script. CI rebuilds it and fails if what is committed no longer matches the source, so run
`pnpm build` and commit the result alongside any change to `src/`.

Other useful commands:

```
pnpm test        # vitest, against a real DOM via happy-dom
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint over the sources
pnpm lint:dist   # eslint-plugin-userscripts over the generated metadata block
pnpm format      # prettier
pnpm dev         # vite in watch mode
```

The five CDN libraries the script depends on stay as `@require` entries rather than being
bundled — `userscript.config.ts` holds that list, and `vite.config.ts` maps the matching
imports back to the globals they define. Two small unmaintained jQuery plugins are vendored
instead; see `src/vendor/README.md`.

### Screenshots

_Market_

![Market](assets/market.png)

_Inventory_

![Inventory](assets/inventory.png)

_Options_

![Options](assets/settings.png)

_Trade offers_

![Tradeoffers](assets/tradeoffer.png)

### License

[MIT](LICENSE) — © 2016 Nuklon, © 2025 Jason Finch.
