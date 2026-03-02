# セミドライスーツ配色シミュレーター v4

19部位マスクを優先した、スマホ向け配色シミュレーターです。  
部位クリック、ステッチ色、プリセット、テーマ内ランダムおすすめ、仕様書PNG出力に対応しています。

## 主な機能
- 19部位のクリック選択と配色変更
- ステッチカラー変更
- プリセット適用
- テーマ選択型ランダムおすすめ
- スーツ画像PNG出力
- 仕様書PNG出力 / 印刷 / 共有URLコピー

## レイアウト
- 上段: 左プレビュー / 右部位選択
- 下段: パネルカラー → ステッチカラー → プリセット/ランダム → 出力/共有
- スマホでは1カラム縦積み

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
- `public/config/presets.json`: プリセット
- `public/config/color-themes.json`: ランダムおすすめ用テーマ

## 部位定義
- `src/lib/partSpec.ts`
- 再採番ルール: 上から順、同高さは前→後 / 左→右

## 仕様ドキュメント
- `docs/persona.md`
- `docs/workflow-19parts-mobile.md`

## ライセンス
MIT
