# 静的 + Supabase（DB）で作る 見込みキャッシュフロー（CF）ツール

## できること
- 入力画面：入金/出金の予定（見込み/確定）を登録
- CF表画面：月次（入金合計・出金合計・差引・月末残高）を表示
- 月毎の一覧表：指定月の明細を表示
- 編集画面：行の更新/削除、見込み↔確定の変更

## 使い方（ざっくり）
1. Supabaseでプロジェクト作成
2. SQL Editorで `supabase.sql` を実行（テーブル作成 + RLS）
3. `config.js` に Supabase URL と anon key を貼る
4. 静的ホスティング（Vercel / Netlify / GitHub Pages / ローカル）に配置して開く

## 注意
- ブラウザでDBにアクセスするため、**RLS（行レベルセキュリティ）必須**です（SQLに含めています）
- 匿名公開ではなく、**Supabase Authでログイン**して使う前提（メールOTP推奨）
- 金額（amount）は必須です（CF計算に必要）

## ローカルでの簡易起動
- VS Code の Live Server などでフォルダを開いて起動
- もしくは `python -m http.server 8080` → http://localhost:8080

## ファイル
- `index.html`：入口（ログイン/ナビ）
- `entry.html`：入力
- `cf.html`：CF表
- `list.html`：月別一覧
- `edit.html`：編集
- `app.css`：共通スタイル
- `config.js`：Supabase設定（あなたのURL/Keyを入れる）
- `app.js`：共通JS（認証・CRUD・集計）
- `supabase.sql`：DB/ポリシー

