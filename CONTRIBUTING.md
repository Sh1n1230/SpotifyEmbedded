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

絞り込んで実行するときは次のようにします。

```bash
npx vitest run src/spec/mood.test.ts      # 1ファイルだけ
npx vitest run -t '見出しの一部'           # 見出しで絞る
npx vitest src/spec/mood.test.ts          # 変更を監視して実行し直す
```

## ライブAPIの確かめ方

| 実行環境 | 起動 | 認証情報なしで確かめられること |
|---|---|---|
| Node | `npm run dev` | 必須の値が無いと案内を出して終わる。ダミーの値を渡せば `/health` と失敗時のカード |
| Workers | `.dev.vars.example` を `.dev.vars` にコピーして `npm run dev:worker` | `/health` と失敗時のカード |
| Docker | `docker build -t spotify-embedded .` のあと `docker run -p 3000:3000 --env-file .env spotify-embedded` | ダミーの値で `/health` と失敗時のカード |

振る舞いを変える PR では、その振る舞いを表すテストを追加・更新してください。カバレッジは目安としてレポートを残すだけで、下限は設けていません。

## プルリクエスト

変更は1つの目的に絞り、利用者から見て何が変わるかを説明し、実行した検証コマンドを書いてください（PR テンプレートのチェック欄を使えます）。マージには CI と Security のワークフローが通っている必要があります。

利用者から見て変わることは、`CHANGELOG.md` の `[Unreleased]` に書いてください。アップグレード時に対応が要るもの（再認証・設定の変更など）は「アップグレード時に確かめること」に書きます。

PR のタイトルは [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形（`<型>: <日本語の説明>`）にします。型は `feat`（機能の追加）・`fix`（不具合の修正）・`docs`（文書）・`test`（テスト）・`refactor`（動作を変えない整理）・`perf`（性能）・`ci`（CI）・`chore`（依存・そのほか）です（例: `fix: Spotify の 429 で Retry-After を返す`）。マージは squash で行い、PR のタイトルがそのまま main のコミットメッセージになります。

ワークフロー・`wrangler.jsonc`・`package.json` などの所有者は `.github/CODEOWNERS` にあります。

脆弱性は公開の Issue や PR に書かず、[Security Advisories](https://github.com/Sh1n1230/SpotifyEmbedded/security/advisories/new) から非公開で報告してください（詳しくは `SECURITY.md`）。

## Issue の書き方

Issue は日本語で、テンプレート（バグ報告・機能要望・ドキュメントの誤り）に沿って書いてください。テンプレートに当てはまらない質問などは、空の Issue で構いません。自分で起票するときは、次の見出しにそろえると読みやすくなります。

- 「何が起きるか」または「解決したい課題」: 今の動作と、該当するファイル・行
- 「提案」: どう直すか（複数の案があれば並べる）
- 「受け入れ条件」: 直ったと判断できる条件をチェックボックスで

脆弱性（秘密情報の漏れ、認証の迂回、他人のデータへのアクセスなど、悪用できるもの）は公開の Issue に書かず、[Security Advisories](https://github.com/Sh1n1230/SpotifyEmbedded/security/advisories/new) から非公開で報告してください。悪用の手段にならない低い深刻度の改善（ヘッダーの追加など）は、タイトルに `[Security/Low]` を付けて Issue にして構いません。

## 依存の更新

Dependabot（`.github/dependabot.yml`）は npm の minor / patch を1つの PR にまとめ、公開から7日たった版だけを提案します。**npm のメジャー更新は提案させていません。** 破壊的変更への追従は1つずつ確かめる必要があり、毎週の PR に混ざると追い切れないためです。その代わり、次の手順で定期的に手動で上げます。

1. **四半期に一度**（1・4・7・10月）、または脆弱性の修正がメジャーにしか出ないと分かったときに行う
2. `npm outdated` でメジャーが上がっている依存を洗い出す
3. 1つずつ上げ、リリースノートの破壊的変更を読んで直し、CI と同じ検査（上の「開発の始め方」）を通す
4. `package.json` の `overrides` もこのとき見直す。固定の理由と外す条件は [`docs/dependencies.md`](docs/dependencies.md) にある
5. 利用者に影響があれば `CHANGELOG.md` に書く

脆弱性はメジャーかどうかに関係なく、Dependabot alerts（有効）で通知されます。

## リポジトリの設定（2026-11-04 時点）

| 項目 | 状態 |
|---|---|
| main のブランチ保護 | ルールセット「protect main」で、削除と force push を禁止し、`security`・`validate (22/24/26)`・`workers-bundle`・`docker`・`package (22/24/26)`・`actionlint` の通過を必須にする（`validate (26)`・`package (26)`・`actionlint` はこの変更で足したジョブなので、ルールセットにも加える）。例外なし。CI の Node のバージョンやジョブ名を変えるときは、ルールセットの必須チェックも更新する |
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
