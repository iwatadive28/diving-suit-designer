# Netlify 公開 5分手順（サンプル用）

この手順は、まず `netlify.app` ドメインでサンプル公開する最短フローです。  
独自ドメイン設定は含みません。

## 前提
- GitHub にこのリポジトリが push 済み
- Netlify アカウント作成済み（無料プランでOK）
- `npm run build` がローカルで成功する状態

## 1. Netlify でサイト作成
1. Netlify にログイン
2. `Add new site` -> `Import an existing project`
3. Git プロバイダで GitHub を選択
4. 対象リポジトリを選ぶ

## 2. ビルド設定（Vite）
- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `20`（未指定でも動くことが多いが、固定推奨）

補足:
- モノレポでなければ Base directory は空のまま

## 3. デプロイ
1. `Deploy site` を実行
2. 数十秒〜数分で初回デプロイ完了
3. 発行されたURL（例: `https://xxx.netlify.app`）へアクセス

## 4. 動作確認（最低限）
1. スマホ表示でプレビューをタップして部位選択できる
2. パネル色・ステッチ色が変更される
3. `全身ブラックにリセット` が動作する
4. 仕様書PNG/URLコピーが動作する

## 5. つまずきポイント
- 404 になる:
  - Publish directory が `dist` になっているか確認
- 画像が出ない:
  - `public/assets/*` がリポジトリに含まれているか確認
- ビルド失敗:
  - NetlifyのDeploy logで `npm run build` エラー行を確認

## 6. 運用メモ（サンプル段階）
- まずは `netlify.app` URLで共有する
- 更新は `develop` もしくは公開対象ブランチへ push で自動反映
- 本番化時に独自ドメインとアクセス制御を追加検討
