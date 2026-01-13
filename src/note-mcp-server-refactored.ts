import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// 設定とユーティリティ
import { env, authStatus } from "./config/environment.js";
import { loginToNote } from "./utils/auth.js";

// ツールとプロンプトの登録
import { registerAllTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/prompts.js";

/**
 * ◤◢◤◢◤◢◤◢◤◢◤◢◤◢
 * note API MCP Server (Refactored)
 *
 * 機能別に分割・リファクタリングされたnote API MCPサーバー
 * - 設定管理の分離
 * - 型定義の整理
 * - 機能別ツール分割
 * - 共通ユーティリティの抽出
 * - エラーハンドリングの統一
 * ◤◢◤◢◤◢◤◢◤◢◤◢◤◢
 */

// MCP サーバーインスタンスを作成
const server = new McpServer({
  name: "note-api",
  version: "2.0.0",
});

/**
 * サーバーの初期化処理
 */
async function initializeServer(): Promise<void> {
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  console.error("🚀 note API MCP Server v2.0.0 を初期化中...");
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

  // ツールの登録
  console.error("📝 ツールを登録中...");
  registerAllTools(server);

  // プロンプトの登録
  console.error("💭 プロンプトを登録中...");
  registerPrompts(server);

  console.error("✅ ツールとプロンプトの登録が完了しました");
}

/**
 * 認証処理の実行
 */
async function performAuthentication(): Promise<void> {
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  console.error("🔐 認証処理を実行中...");
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

  // 自動ログインの試行
  if (env.NOTE_EMAIL && env.NOTE_PASSWORD) {
    console.error("📧 メールアドレスとパスワードからログイン試行中...");
    const loginSuccess = await loginToNote();
    if (loginSuccess) {
      console.error("✅ ログイン成功: セッションCookieを取得しました");
    } else {
      console.error("❌ ログイン失敗: メールアドレスまたはパスワードが正しくない可能性があります");
    }
  }

  // 認証状態の表示
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  if (authStatus.hasCookie || authStatus.anyAuth) {
    console.error("🔓 認証情報が設定されています");
    console.error("✨ 認証が必要な機能も利用できます");
  } else {
    console.error("⚠️  警告: 認証情報が設定されていません");
    console.error("👀 読み取り機能のみ利用可能です");
    console.error(
      "📝 投稿、コメント、スキなどの機能を使うには.envファイルに認証情報を設定してください"
    );
  }
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
}

/**
 * サーバーの起動
 */
async function startServer(): Promise<void> {
  try {
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    console.error("🌟 note API MCP Server v2.0.0 を起動中...");
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

    // サーバーの初期化
    await initializeServer();

    // 認証処理
    await performAuthentication();

    // STDIOトランスポートを作成して接続
    console.error("🔌 STDIOトランスポートに接続中...");
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    console.error("🎉 note API MCP Server v2.0.0 が正常に起動しました!");
    console.error("📡 STDIO transport で稼働中");
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

    // 利用可能な機能の概要表示
    console.error("\n📋 利用可能な機能:");
    console.error("🔍 検索機能:");
    console.error("  - search-notes: 記事検索");
    console.error("  - analyze-notes: 記事分析");
    console.error("  - search-users: ユーザー検索");
    console.error("  - search-magazines: マガジン検索");
    console.error("  - search-all: 全体検索");

    console.error("\n📝 記事機能:");
    console.error("  - get-note: 記事詳細取得");
    console.error("  - post-draft-note: 下書き投稿");
    console.error("  - get-comments: コメント取得");
    console.error("  - post-comment: コメント投稿");
    console.error("  - like-note / unlike-note: スキ操作");
    console.error("  - get-my-notes: 自分の記事一覧");

    console.error("\n👥 ユーザー機能:");
    console.error("  - get-user: ユーザー詳細取得");
    console.error("  - get-user-notes: ユーザーの記事一覧");
    console.error("  - get-stats: PV統計取得");

    console.error("\n🎪 メンバーシップ機能:");
    console.error("  - get-membership-summaries: 加入メンバーシップ一覧");
    console.error("  - get-membership-plans: 自分のプラン一覧");
    console.error("  - get-membership-notes: メンバーシップ記事一覧");
    console.error("  - get-circle-info: サークル情報取得");

    console.error("\n📚 その他機能:");
    console.error("  - get-magazine: マガジン詳細取得");
    console.error("  - list-categories: カテゴリー一覧");
    console.error("  - list-hashtags: ハッシュタグ一覧");
    console.error("  - get-notice-counts: 通知件数");

    console.error("\n💭 プロンプト:");
    console.error("  - note-search: 記事検索プロンプト");
    console.error("  - competitor-analysis: 競合分析");
    console.error("  - content-idea-generation: アイデア生成");
    console.error("  - article-analysis: 記事分析");
    console.error("  - membership-strategy: メンバーシップ戦略");
    console.error("  - content-calendar: コンテンツカレンダー");

    console.error("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    console.error("🎯 Ready for requests!");
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  } catch (error) {
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    console.error("💥 Fatal error during server startup:");
    console.error(error);
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    process.exit(1);
  }
}

// メイン処理の実行
startServer().catch((error) => {
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  console.error("💥 Fatal error:");
  console.error(error);
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  process.exit(1);
});

// ファイル情報の表示（開発用）
if (env.DEBUG) {
  console.error("📂 リファクタリング情報:");
  console.error("📁 設定: src/config/");
  console.error("🏷️  型定義: src/types/");
  console.error("🔧 ユーティリティ: src/utils/");
  console.error("🛠️  ツール: src/tools/");
  console.error("💭 プロンプト: src/prompts/");
  console.error("🚀 メインサーバー: src/note-mcp-server-refactored.ts");
}
