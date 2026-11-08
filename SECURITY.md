# セキュリティポリシー

## 脆弱性の報告

脆弱性は**公開の Issue・プルリクエスト・Discussions には書かないでください。**

リポジトリの Security タブにある「Report a vulnerability」（[報告フォーム](https://github.com/Sh1n1230/SpotifyEmbedded/security/advisories/new)）から、非公開で報告してください。報告の内容はメンテナーにだけ見え、修正と公開の段取りもそこで相談します。

報告には、再現の手順・影響を受ける版・想定される影響を書いてください。英語での報告も受け付けます（Reports in English are welcome.）。

## 報告の後の流れ

1. メンテナーが報告の内容を確かめ、再現と影響の範囲について報告フォームの中でやり取りします（個人で運営しているので、返答の期日は決めていません）
2. 修正は公開の Issue や PR にせず、Security Advisory の非公開のフォークで進めます
3. 修正をリリースしてから Security Advisory を公開します。報告者の名前を載せるかは、報告者に確かめます

## 対象とする版

修正は**最新のリリースに対してだけ**行います。古い版を使っている場合は、最新の版で再現するかを確かめてから報告してください。

| 版 | 対象 |
|---|---|
| 最新のリリース | ✅ |
| それより前 | ❌ |

## 対象と対象外

| | 例 |
|---|---|
| **対象** | このリポジトリのコード・GitHub Actions のワークフローの脆弱性 |
| **対象外** | README で避けるよう書いている構成で起きること（`CORS_ORIGIN=*` のままの公開、プロキシの裏でない環境での `TRUSTED_PROXY_HEADER`、公開環境での `ENABLE_AUTH_ROUTES`）、Spotify や LLM のサービス側の問題 |

## 認証情報の扱い

Spotify の Client Secret・refresh_token、LLM の API キー、GitHub Actions の Secrets は絶対にコミットしないでください。`npm run setup` を手元で実行し、本番の値はデプロイ先のシークレット管理機能（GitHub Secrets・`wrangler secret`・`fly secrets` など）に置いてください。
