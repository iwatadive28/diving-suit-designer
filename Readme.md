# セミドライスーツ配色シミュレーター v5

19部位マスクを優先した、スマホ向け配色シミュレーターです。  
画像タップ地点パレットでの色選択、ステッチ色、プリセット、テーマ内ランダムおすすめ、仕様書PNG出力に対応しています。

## 主な機能
- 19部位のクリック選択と配色変更
- 画像タップ地点に色パレットを表示して即時配色
- 部位ごとの選択色制限（初期実装: 膝パッドは白/黒のみ）
- ステッチカラー変更
- プリセット適用
- テーマ選択型ランダムおすすめ
- スーツ画像PNG出力
- 仕様書PNG出力 / 印刷 / 共有URLコピー

## レイアウト
- 上段: 左プレビュー / 右部位選択（折りたたみ可）
- 下段: パネルカラー → ステッチカラー → プリセット/ランダム → 出力/共有
- スマホでは1カラム縦積み、色選択は画像タップ中心

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
- `public/config/colors.json`: パネルカラー
- `public/config/stitch-colors.json`: ステッチカラー
- `public/config/parts.json`: 部位定義（allowColorsで部位別制限）
- `public/config/presets.json`: プリセット
- `public/config/color-themes.json`: ランダムおすすめ用テーマ

## 部位定義
- `src/lib/partSpec.ts`: 描画順・マスク参照の基準
- `public/config/parts.json`: 表示名・初期色・選択可能色
- 再採番ルール: 上から順、同高さは前→後 / 左→右

## 仕様ドキュメント
- `docs/persona.md`
- `docs/workflow-19parts-mobile.md`

## ライセンス
MIT
