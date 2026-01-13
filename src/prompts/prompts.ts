import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * プロンプトをMCPサーバーに登録する
 * @param server MCPサーバーインスタンス
 */
export function registerPrompts(server: McpServer): void {
  // 検索用のプロンプトテンプレート
  server.prompt(
    "note-search",
    {
      query: z.string().describe("検索したいキーワード"),
    },
    ({ query }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `note.comで「${query}」に関する記事を検索して、要約してください。特に参考になりそうな記事があれば詳しく教えてください。`,
          },
        },
      ],
    })
  );

  // 競合分析プロンプト
  server.prompt(
    "competitor-analysis",
    {
      username: z.string().describe("分析したい競合のユーザー名"),
    },
    ({ username }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `note.comの「${username}」というユーザーの記事を分析して、以下の観点から教えてください：\n\n- 主なコンテンツの傾向\n- 人気記事の特徴\n- 投稿の頻度\n- エンゲージメントの高い記事の特徴\n- 差別化できそうなポイント`,
          },
        },
      ],
    })
  );

  // アイデア生成プロンプト
  server.prompt(
    "content-idea-generation",
    {
      topic: z.string().describe("記事のトピック"),
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `「${topic}」に関するnote.comの記事のアイデアを5つ考えてください。各アイデアには以下を含めてください：\n\n- キャッチーなタイトル案\n- 記事の概要（100文字程度）\n- 含めるべき主なポイント（3-5つ）\n- 差別化できるユニークな切り口`,
          },
        },
      ],
    })
  );

  // 記事分析プロンプト
  server.prompt(
    "article-analysis",
    {
      noteId: z.string().describe("分析したい記事のID"),
    },
    ({ noteId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `note.comの記事ID「${noteId}」の内容を分析して、以下の観点から教えてください：\n\n- 記事の主なテーマと要点\n- 文章の構成と特徴\n- エンゲージメントを得ている要素\n- 改善できそうなポイント\n- 参考にできる文章テクニック`,
          },
        },
      ],
    })
  );

  // メンバーシップ戦略プロンプト
  server.prompt(
    "membership-strategy",
    {
      topic: z.string().describe("メンバーシップのテーマ"),
      price: z.string().describe("価格設定（円）"),
    },
    ({ topic, price }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `「${topic}」をテーマとした月額${price}円のnoteメンバーシップの戦略を考えてください：\n\n- ターゲット層の設定\n- 提供する価値とコンテンツ内容\n- 差別化ポイント\n- 集客戦略\n- 継続率向上のための施策\n- 収益シミュレーション`,
          },
        },
      ],
    })
  );

  // コンテンツカレンダープロンプト
  server.prompt(
    "content-calendar",
    {
      theme: z.string().describe("コンテンツのテーマ"),
      period: z.enum(["week", "month", "quarter"]).describe("期間"),
    },
    ({ theme, period }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `「${theme}」をテーマとした${period === "week" ? "1週間" : period === "month" ? "1ヶ月" : "3ヶ月"}分のnote投稿カレンダーを作成してください：\n\n- 投稿頻度と曜日の提案\n- 各記事のタイトル案\n- コンテンツの種類（テキスト/画像/動画等）\n- ハッシュタグ戦略\n- エンゲージメント向上のための工夫`,
          },
        },
      ],
    })
  );
}
