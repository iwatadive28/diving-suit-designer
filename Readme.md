# セミドライスーツ配色シミュレーター vNext

19部位マスクを優先した、スマホ向け配色シミュレーターです。  
画像タップ地点パレット、ピンチズーム、ステッチ色、プリセット、柄反映、仕様書PNG出力に対応しています。

## 主な機能
- 19部位のクリック選択と配色変更
- 画像タップ地点に色パレットを表示して即時配色
- ピンチズーム + ドラッグ移動 + ダブルタップで等倍
- 部位ごとの選択色制限（初期実装: 膝パッドは白/黒のみ）
- ステッチカラー変更
- 柄色対応（チェッカー赤/黒、カモカーキ、カモグレイ）
- 全身ブラックにリセット（パネル+ステッチ）
- プリセット適用 / ランダムおすすめ
- スーツ画像PNG出力
- 仕様書PNG出力 / 印刷 / 共有URLコピー

## レイアウト
- 上段: 左プレビュー / 右部位選択（折りたたみ可）
- 下段: パネルカラー / ステッチカラー
- スマホ: 右上バーガーメニューから「プリセット/ランダム」「出力/共有」を操作

## ローカル起動
```bash
npm install
npm run dev
```

`http://localhost:5173` を開いてください。

## ビルド / テスト
```bash
npm run build
npm run test
```

## 設定ファイル
- `public/config/colors.json`: パネルカラー（`patternTile` で柄タイル指定）
- `public/config/stitch-colors.json`: ステッチカラー
- `public/config/parts.json`: 部位定義（allowColorsで部位別制限）
- `public/config/presets.json`: プリセット
- `public/config/color-themes.json`: ランダムおすすめ用テーマ

## 柄タイル
- `public/assets/patterns/checker_red.png`
- `public/assets/patterns/checker_black.png`
- `public/assets/patterns/camo_khaki.png`
- `public/assets/patterns/camo_gray.png`

## 部位定義
- `src/lib/partSpec.ts`: 描画順・マスク参照の基準
- `public/config/parts.json`: 表示名・初期色・選択可能色
- 再採番ルール: 上から順、同高さは前→後 / 左→右

## 仕様ドキュメント
- `docs/persona.md`
- `docs/workflow-19parts-mobile.md`

## ライセンス
MIT
