# note.com APIキャプチャガイド

## 🎯 概要

note.comの認証情報を自動取得するためのガイドです。Puppeteerを使用してブラウザ操作を自動化し、セッションCookieと認証トークンを取得します。

## 📋 必要なもの

- Node.js (v16以上)
- npm
- note.comアカウント

## 🚀 セットアップ

### 1. Puppeteerをインストール

```bash
npm install puppeteer
```

### 2. .envファイルを準備

```bash
# .env.exampleをコピー
cp .env.example .env

# 認証情報を編集
NOTE_EMAIL=your-email@example.com
NOTE_PASSWORD=your-password
NOTE_USER_ID=your-username
```

## 🤖 自動キャプチャの実行

### 方法1: スクリプトを実行

```bash
# セッションキャプチャを実行
node scripts/capture-session.js
```

### 方法2: npmスクリプトを使用

```bash
# package.jsonに追加後
npm run capture:session
```

## 📝 実行手順

### 1. スクリプト実行

```bash
node scripts/capture-session.js
```

### 2. ブラウザが自動起動

- Chromeブラウザが自動的に起動
- note.comのログインページが開く
- 認証情報が自動入力され、ログイン実行

### 3. セッション情報取得

- セッションCookie (`_note_session_v5`) を取得
- XSRFトークンを取得
- ユーザーIDを取得
- .envファイルを自動更新

### 4. MCPサーバー再起動

```bash
# HTTPサーバーを再起動
npm run start:http
```

## 🔧 手動キャプチャ（バックアップ）

### 1. ブラウザでログイン

1. https://note.com にアクセス
2. メールアドレスとパスワードでログイン

### 2. 開発者ツールを開く

- Chrome: F12 → Application → Storage → Cookies
- Firefox: F12 → Storage → Cookies

### 3. Cookieを取得

```
_note_session_v5: [セッションCookieの値]
XSRF-TOKEN: [XSRFトークンの値]
```

### 4. .envに設定

```bash
NOTE_SESSION_V5=取得したセッションCookie
NOTE_XSRF_TOKEN=取得したXSRFトークン
```

## 📊 取得される情報

| 項目 | 説明 | 用途 |
|------|------|------|
| `_note_session_v5` | セッションCookie | 認証 |
| `XSRF-TOKEN` | CSRFトークン | APIリクエスト保護 |
| `NOTE_USER_ID` | ユーザーID | ユーザー固有機能 |

## ⚠️ 注意事項

### セキュリティ
- セッション情報は機密情報です
- .envファイルは.gitignoreに含まれています
- 決してGitHub等にコミットしないでください

### 有効期限
- セッションCookieには有効期限があります
- ログアウトすると無効になります
- 定期的に再取得が必要です

### 自動化の制限
- note.comの仕様変更により動作しなくなる可能性があります
- 手動取得をバックアップとして覚えておいてください

## 🔍 トラブルシューティング

### ログイン失敗
```
❌ メールアドレスまたはパスワードが正しくありません
```
**対処法:**
- .envの認証情報を確認
- note.comで直接ログインできるか確認

### セッションCookieが見つからない
```
❌ セッションCookieが見つかりません
```
**対処法:**
- note.comのログインプロセスが完了しているか確認
- 手動でCookieを取得

### Puppeteerエラー
```
Error: Failed to launch browser
```
**対処法:**
- Puppeteerの再インストール: `npm reinstall puppeteer`
- システムのChromeバージョンを確認

## 📚 関連ドキュメント

- [README.md](../README.md) - 基本的な使い方
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - デプロイガイド
- [CLOUDFLARE_TUNNEL_SETUP.md](./CLOUDFLARE_TUNNEL_SETUP.md) - 外部アクセス設定

## 🆘 サポート

問題が発生した場合:
1. このガイドのトラブルシューティングを確認
2. 手動キャプチャを試す
3. GitHub Issuesで報告

---

**🎉 これでnote.comのすべての機能がMCP経由で利用できます！**
