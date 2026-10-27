# 依存の固定（package.json の overrides）

`overrides` は推移的な依存の版を上書きする。Dependabot は overrides を更新しないので、
ここに理由と外す条件を残し、見直しのたびに確かめる（見直しの手順は CONTRIBUTING の「依存の更新」）。

いずれも devDependencies 経由で、Workers のバンドルと Docker イメージには入らない。

| 対象 | 固定する版 | 理由 | 経由する依存 | 外せる条件 |
|---|---|---|---|---|
| `source-map-js` | 1.2.2 | GHSA-68fv-2mgg-jv7q（1.2.1 以前）。#24 / #26 で導入 | `css-tree`（jsdom）・`magicast`（@vitest/coverage-v8）が `^1.2.1` を要求。`postcss`（vite）は `^1.2.2` | 経由するすべての依存の要求範囲が `^1.2.2` 以上になったとき |
| `undici` | 7.30.1 | `miniflare` が 7.29.1 を完全一致で固定しており、修正版に上がらない。#92 で導入 | `wrangler` → `miniflare`。jsdom（`^8.11.2` を要求）にも 7.30.1 が入る | `miniflare` が 7.30.1 以上を要求するようになったとき |

## 外したもの

- `sharp`（0.35.5 に固定していた。GHSA-wq5f-xc86-pv6w、#24 / #26）: `miniflare` 自身が 0.35.5 を要求するようになったため 2026-10-28 に外した

`undici` を `miniflare` の中だけに絞る形（`"miniflare": { "undici": "7.30.1" }`）も試したが、npm 10（Node 22 に同梱）の `npm ci` がロックファイルと一致しないと判定して失敗したため、全体での固定に戻した。jsdom は undici 7 でも spec がすべて通る。

## 見直し方

```bash
npm ls source-map-js undici sharp   # どこから入り、overridden かを確かめる
npm audit                           # 外したあとに脆弱性が戻らないことを確かめる
```
