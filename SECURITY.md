# セキュリティポリシー

## 脆弱性の報告

脆弱性は**公開の Issue・プルリクエスト・Discussions には書かないでください。**

リポジトリの Security タブにある「Report a vulnerability」（[報告フォーム](https://github.com/Sh1n1230/SpotifyEmbedded/security/advisories/new)）から、非公開で報告してください。報告の内容はメンテナーにだけ見え、修正と公開の段取りもそこで相談します。

報告には、再現の手順・影響を受ける版・想定される影響を書いてください。英語での報告も受け付けます（Reports in English are welcome.）。

## 対象とする版

修正は**最新のリリースに対してだけ**行います。古い版を使っている場合は、最新の版で再現するかを確かめてから報告してください。

| 版 | 対象 |
|---|---|
| 最新のリリース | ✅ |
| それより前 | ❌ |

## 認証情報の扱い

Spotify の Client Secret・refresh_token、LLM の API キー、GitHub Actions の Secrets は絶対にコミットしないでください。`npm run setup` を手元で実行し、本番の値はデプロイ先のシークレット管理機能（GitHub Secrets・`wrangler secret`・`fly secrets` など）に置いてください。
