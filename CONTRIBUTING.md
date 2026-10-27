# コントリビューションの手引き

SpotifyEmbedded へのコントリビューションに興味を持っていただき、ありがとうございます。

## 開発の始め方

Node.js は `.nvmrc` の版（24）を使います。`nvm use`（または fnm・Volta など `.nvmrc` を読むツール）で揃えられます。
動作を保証する範囲は `package.json` の `engines`（22 以上）で、CI は 22 と 24 の両方で確かめます。Docker イメージと各デプロイのワークフローは 24 です。

CI（`.github/workflows/ci.yml`）と同じ検査を、同じ順番で手元でも実行できます。

```bash
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test               # カバレッジも見るなら npm run test:coverage（coverage/ に出力）
npm run build
```

依存パッケージの install スクリプトは実行しません（どれも無しで動きます）。

CI はこのほかに、Workers 向けのバンドル（`npx wrangler deploy --dry-run`）、Docker イメージのビルドと起動、`npm pack` した成果物のインストールと起動も確かめます。

`npm run setup` は、自分の Spotify の認証情報を使うときだけ実行してください。`.env`、`data/auth.json`、refresh_token、API キー、生成した個人のスナップショットは絶対にコミットしないでください。

## テスト

`src/spec/*.test.ts` は「この製品が満たすと約束している振る舞い」をまとめた、実行できる仕様書です。網羅率のためのテストではありません。領域ごとにファイルを分け（`spotify`・`static-generate`・`mood`・`live-api`・`browser` など）、fetch のモックやフィクスチャは `src/spec/support.ts` にあります。

- `describe` の見出しが、そのまま要件として読めるように書く
- モックは `fetch` の層で行う。モジュールごと差し替えると「どの URL を・どのクエリで・どのヘッダーで叩いたか」が検証から抜け落ちる
- フィクスチャの既定値は「2024年11月以降に作成された Spotify アプリ」（popularity / genres / preview_url が返らない）とする
- 実際の Spotify API や LLM の API は呼ばない
- ブラウザで動くスクリプト（`public/embed.js`・`public/demo.js`・`/embed` のライブ更新）は `src/spec/browser.test.ts` で jsdom の上で動かす

振る舞いを変える PR では、その振る舞いを表すテストを追加・更新してください。カバレッジは目安としてレポートを残すだけで、下限は設けていません。

## プルリクエスト

変更は1つの目的に絞り、利用者から見て何が変わるかを説明し、実行した検証コマンドを書いてください（PR テンプレートのチェック欄を使えます）。マージには CI と Security のワークフローが通っている必要があります。

利用者から見て変わることは、`CHANGELOG.md` の `[Unreleased]` に書いてください。アップグレード時に対応が要るもの（再認証・設定の変更など）は「アップグレード時に確かめること」に書きます。

ワークフロー・`wrangler.jsonc`・`package.json` などの所有者は `.github/CODEOWNERS` にあります。

脆弱性は公開の Issue や PR に書かず、[Security Advisories](https://github.com/Sh1n1230/SpotifyEmbedded/security/advisories/new) から非公開で報告してください（詳しくは `SECURITY.md`）。

## 依存の更新

Dependabot（`.github/dependabot.yml`）は npm の minor / patch を1つの PR にまとめ、公開から7日たった版だけを提案します。**npm のメジャー更新は提案させていません。** 破壊的変更への追従は1つずつ確かめる必要があり、毎週の PR に混ざると追い切れないためです。その代わり、次の手順で定期的に手動で上げます。

1. **四半期に一度**（1・4・7・10月）、または脆弱性の修正がメジャーにしか出ないと分かったときに行う
2. `npm outdated` でメジャーが上がっている依存を洗い出す
3. 1つずつ上げ、リリースノートの破壊的変更を読んで直し、CI と同じ検査（上の「開発の始め方」）を通す
4. `package.json` の `overrides` もこのとき見直す。固定の理由と外す条件は [`docs/dependencies.md`](docs/dependencies.md) にある
5. 利用者に影響があれば `CHANGELOG.md` に書く

脆弱性はメジャーかどうかに関係なく、Dependabot alerts（有効）で通知されます。

## リポジトリの設定（2026-10-28 時点）

| 項目 | 状態 |
|---|---|
| main のブランチ保護 | なし。ルールセット「protect main」はあるが無効（`enforcement: disabled`） |
| Environment `cloudflare`（Workers へのデプロイ） | 承認の必須・ブランチの制限なし |
| Environment `github-pages` | デプロイできるブランチを限定 |
| Dependabot alerts | 有効（security updates の自動 PR は無効） |
| Private vulnerability reporting | 有効 |

## リリース

リリースはセマンティックバージョニングのタグから作られます。`package.json` と `package-lock.json` の `version` を更新し、`CHANGELOG.md` の `[Unreleased]` をその版の見出し（`## [1.0.1] - 日付`）に変えたうえで、`v1.0.1` のようなタグを push します。

```bash
git tag v1.0.1
git push origin v1.0.1
```

Release のワークフローは、タグと `package.json`・`package-lock.json` の `version` が一致しないとき、`CHANGELOG.md` にその版の見出しが無いときに失敗します。通れば、CI と同じ型検査・lint・テスト・ビルドを行い、npm パッケージのアーカイブを添付して、GitHub Release のリリースノートを自動生成します。
