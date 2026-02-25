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

  // PDCAレビュープロンプト
  server.prompt(
    "pdca-review",
    {
      period: z.enum(["week", "month"]).describe("レビュー期間"),
    },
    ({ period }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `noteアカウントの${period === "week" ? "週次" : "月次"}PDCAレビューを実施してください。\n\n以下の手順で進めてください：\n1. analyze-content-performanceで${period}のパフォーマンスデータを取得\n2. get-editorial-voiceで編集方針を確認\n3. データに基づいてPlan/Do/Check/Actの各項目を具体的に提案\n4. 次の${period === "week" ? "1週間" : "1ヶ月"}のアクションアイテムを3-5つ提示\n\n数値データに基づいた具体的な改善提案をお願いします。`,
          },
        },
      ],
    })
  );

  // 朝のルーティンプロンプト
  server.prompt(
    "morning-routine",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `noteアカウントの朝のルーティンチェックを実行してください。\n\n以下を順番に実施してください：\n1. run-content-workflowでmorning-checkを実行し、PV統計と通知を確認\n2. 下書きがあれば、完成度の高いものを報告\n3. 今日の投稿推奨アクションを提案\n4. 重要な数値の変化があればハイライト\n\n簡潔なダッシュボード形式で結果をまとめてください。`,
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

  // 自律振り返りプロンプト
  server.prompt(
    "autonomous-reflection",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `noteアカウントの自律振り返りを実行してください。

以下の手順で進めてください：
1. get-memoriesで過去の記憶を確認（直近20件）
2. analyze-content-performanceで現在のパフォーマンスを分析
3. compare-pdca-cyclesで前回との比較を確認
4. get-editorial-voiceで編集方針を確認
5. 以上を踏まえて、record-memoryで新しい洞察を記録
6. 次のアクションを3つ提案

過去の記憶・パフォーマンスデータ・PDCA履歴を総合的に判断し、具体的な改善提案をしてください。`,
          },
        },
      ],
    })
  );

  // 完全自律サイクルプロンプト
  server.prompt(
    "autonomous-cycle",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `noteアカウントの完全自律サイクルを実行してください。

以下の手順で進めてください：
1. run-autonomous-cycleを実行して現状を把握
2. 結果に基づいてauto-generate-articleでテーマ候補を生成
3. 最も有望なテーマでcreate-draft（下書き作成）を提案
4. run-feedback-loopで次回への学びを記録
5. 結果のサマリーをsend-reportで通知

データ駆動で判断し、各ステップの結果を踏まえて次のアクションを決定してください。`,
          },
        },
      ],
    })
  );

  // 日次ルーティンプロンプト
  server.prompt(
    "daily-routine",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `noteアカウントの日次ルーティンを実行してください。

以下の手順で進めてください：
1. run-autonomous-cycle period=week で現状把握
2. 下書きがあればrun-content-workflow workflow=publish-readiness でチェック
3. run-feedback-loopで今日のアクションを決定
4. 結果をsend-reportで通知

簡潔なダッシュボード形式で結果をまとめてください。`,
          },
        },
      ],
    })
  );

  // マネタイズレビュープロンプト
  server.prompt(
    "monetization-review",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `noteアカウントのマネタイズレビューを実行してください。

以下の手順で進めてください：
1. analyze-revenueで有料/無料記事のパフォーマンスを比較
2. suggest-promotion-strategyで宣伝すべき記事と戦略を確認
3. 有望な記事に対してgenerate-promotionでTwitter宣伝テキストを生成
4. 収益改善のための具体的なアクションプランを3-5項目提案
5. 結果をrecord-memoryで記録

データに基づいた実践的なマネタイズ改善提案をお願いします。`,
          },
        },
      ],
    })
  );
}
