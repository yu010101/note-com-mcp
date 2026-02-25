import { z } from "zod";
import { randomUUID } from "crypto";
import { TwitterApi } from "twitter-api-v2";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { readEditorialVoice } from "../utils/voice-reader.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { env } from "../config/environment.js";
import { MemoryEntry, PromotionEntry } from "../types/analytics-types.js";

const MEMORY_FILE = "memory-data.json";

function getTwitterClient(): TwitterApi | null {
  if (
    !env.TWITTER_API_KEY ||
    !env.TWITTER_API_SECRET ||
    !env.TWITTER_ACCESS_TOKEN ||
    !env.TWITTER_ACCESS_SECRET
  ) {
    return null;
  }
  return new TwitterApi({
    appKey: env.TWITTER_API_KEY,
    appSecret: env.TWITTER_API_SECRET,
    accessToken: env.TWITTER_ACCESS_TOKEN,
    accessSecret: env.TWITTER_ACCESS_SECRET,
  });
}

export function registerPromotionTools(server: McpServer) {
  // --- generate-promotion ---
  server.tool(
    "generate-promotion",
    "記事のSNS宣伝テキストを自動生成する。Twitter(140字)・Threads(500字)・汎用フォーマットに対応。editorial-voiceと成功パターンを参考にキャッチコピーを生成。",
    {
      articleTitle: z.string().describe("記事タイトル"),
      articleUrl: z.string().describe("記事URL"),
      platform: z
        .enum(["twitter", "threads", "generic"])
        .default("twitter")
        .describe("対象プラットフォーム"),
      additionalContext: z.string().optional().describe("追加コンテキスト（記事の要約等）"),
    },
    async ({ articleTitle, articleUrl, platform, additionalContext }) => {
      try {
        const voice = readEditorialVoice();

        // 成功パターンからヒントを取得
        const memories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);
        const insights = memories
          .filter((m) => m.type === "insight")
          .slice(0, 5);

        // ハッシュタグ生成
        const hashtags: string[] = [];
        for (const topic of voice.topicFocus.slice(0, 3)) {
          hashtags.push(`#${topic.replace(/\s+/g, "")}`);
        }
        if (voice.toneKeywords.length > 0) {
          hashtags.push(`#${voice.toneKeywords[0].replace(/\s+/g, "")}`);
        }
        hashtags.push("#note");

        // プラットフォーム別テキスト生成
        let text = "";
        const hashtagStr = hashtags.join(" ");

        switch (platform) {
          case "twitter": {
            // Twitter: 280文字制限（日本語は140文字相当）
            // URL は t.co短縮で23文字
            const urlChars = 24; // t.co + space
            const hashtagChars = hashtagStr.length + 1;
            const maxBody = 280 - urlChars - hashtagChars - 2; // 改行分

            let body = "";
            if (additionalContext) {
              body = additionalContext.length > maxBody
                ? additionalContext.slice(0, maxBody - 3) + "..."
                : additionalContext;
            } else {
              // editorial-voiceのスタイルでキャッチコピー
              const catchphrases = voice.examplePhrases;
              const prefix = catchphrases.length > 0
                ? catchphrases[Math.floor(Math.random() * catchphrases.length)]
                : "";
              body = `${prefix}「${articleTitle}」を書きました`;
              if (body.length > maxBody) {
                body = `「${articleTitle}」を書きました`;
              }
              if (body.length > maxBody) {
                body = articleTitle.slice(0, maxBody - 3) + "...";
              }
            }

            text = `${body}\n\n${articleUrl}\n${hashtagStr}`;
            break;
          }

          case "threads": {
            // Threads: 500文字制限
            const body = additionalContext
              ? `${additionalContext}\n\n「${articleTitle}」`
              : `${voice.examplePhrases[0] || ""}「${articleTitle}」について書きました。\n\nぜひ読んでみてください。`;

            text = `${body}\n\n${articleUrl}\n\n${hashtagStr}`;
            if (text.length > 500) {
              text = `「${articleTitle}」\n\n${articleUrl}\n\n${hashtagStr}`;
            }
            break;
          }

          case "generic":
          default: {
            text = additionalContext
              ? `${additionalContext}\n\n「${articleTitle}」\n${articleUrl}\n\n${hashtagStr}`
              : `新しい記事を公開しました: 「${articleTitle}」\n\n${articleUrl}\n\n${hashtagStr}`;
            break;
          }
        }

        const promotion: PromotionEntry = {
          platform,
          text,
          hashtags,
          url: articleUrl,
          articleTitle,
          generatedAt: new Date().toISOString(),
        };

        return createSuccessResponse({
          status: "generated",
          promotion,
          charCount: text.length,
          insightsUsed: insights.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`宣伝テキスト生成に失敗しました: ${message}`);
      }
    }
  );

  // --- cross-post ---
  server.tool(
    "cross-post",
    "SNSにクロスポストする。Twitter/XはAPI v2で直接投稿、その他はWebhook経由。投稿結果は記憶に自動記録。",
    {
      platform: z
        .enum(["twitter", "webhook"])
        .describe("投稿先（twitter: Twitter API v2直接投稿, webhook: SNS_WEBHOOK_URL経由）"),
      text: z.string().describe("投稿テキスト（generate-promotionの出力を使用推奨）"),
      articleTitle: z.string().optional().describe("元記事タイトル（記憶記録用）"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueで実際の投稿をスキップ"),
    },
    async ({ platform, text, articleTitle, dryRun }) => {
      try {
        let result: { posted: boolean; tweetId?: string; error?: string } = { posted: false };

        if (dryRun) {
          return createSuccessResponse({
            status: "dry_run",
            platform,
            text,
            charCount: text.length,
            message: "dryRunモード: 実際の投稿はスキップされました",
          });
        }

        switch (platform) {
          case "twitter": {
            const client = getTwitterClient();
            if (!client) {
              return createErrorResponse(
                "Twitter API未設定です。環境変数 TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET を設定してください。"
              );
            }

            try {
              const tweet = await client.v2.tweet(text);
              result = {
                posted: true,
                tweetId: tweet.data.id,
              };
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              result = { posted: false, error: errMsg };
            }
            break;
          }

          case "webhook": {
            const webhookUrl = env.SNS_WEBHOOK_URL || env.WEBHOOK_URL;
            if (!webhookUrl) {
              return createErrorResponse(
                "Webhook URL未設定です。環境変数 SNS_WEBHOOK_URL または WEBHOOK_URL を設定してください。"
              );
            }

            try {
              const response = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "sns_cross_post",
                  text,
                  articleTitle: articleTitle ?? "",
                  timestamp: new Date().toISOString(),
                }),
              });
              result = { posted: response.ok };
              if (!response.ok) {
                result.error = `HTTP ${response.status}`;
              }
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              result = { posted: false, error: errMsg };
            }
            break;
          }
        }

        // 記憶に記録
        try {
          const entry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: result.posted
              ? `${platform}にクロスポスト成功: 「${articleTitle || "記事"}」${result.tweetId ? ` (tweetId: ${result.tweetId})` : ""}`
              : `${platform}へのクロスポスト失敗: ${result.error}`,
            source: "cross-post",
            tags: ["cross-post", platform, result.posted ? "success" : "failure"],
          };
          appendToJsonArray(MEMORY_FILE, entry);
        } catch {
          // 記憶保存失敗は無視
        }

        if (result.posted) {
          return createSuccessResponse({
            status: "posted",
            platform,
            tweetId: result.tweetId,
            charCount: text.length,
          });
        } else {
          return createErrorResponse(
            `${platform}への投稿に失敗しました: ${result.error}`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`クロスポストに失敗しました: ${message}`);
      }
    }
  );

  // --- suggest-promotion-strategy ---
  server.tool(
    "suggest-promotion-strategy",
    "パフォーマンスデータ・記憶・editorial-voiceから最適な宣伝戦略を提案する。どの記事を・いつ・どのSNSで宣伝すべきかをデータ駆動で判断。",
    {},
    async () => {
      try {
        // データ収集
        const [weekly, monthly, all] = await Promise.all([
          fetchAllStats("week"),
          fetchAllStats("month"),
          fetchAllStats("all"),
        ]);

        const weeklyMap = new Map(weekly.map((s) => [s.noteId, s.readCount]));
        const monthlyMap = new Map(monthly.map((s) => [s.noteId, s.readCount]));
        const allMap = new Map(
          all.map((s) => [s.noteId, { title: s.title, key: s.key, user: s.user, readCount: s.readCount }])
        );

        const trends = computeTrends(weeklyMap, monthlyMap, allMap);
        const { topArticles, risingArticles } = categorizeArticles(trends, 5);

        const voice = readEditorialVoice();
        const memories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);

        // 過去のクロスポスト結果を分析
        const crossPostMemories = memories.filter((m) => m.tags.includes("cross-post"));
        const successPosts = crossPostMemories.filter((m) => m.tags.includes("success")).length;
        const failurePosts = crossPostMemories.filter((m) => m.tags.includes("failure")).length;

        // 宣伝候補記事の選定
        const promotionCandidates: {
          title: string;
          url: string;
          reason: string;
          priority: "high" | "medium" | "low";
          suggestedPlatform: string;
          suggestedTiming: string;
        }[] = [];

        // 上昇トレンド記事 = 勢いに乗せるべき
        for (const article of risingArticles.slice(0, 3)) {
          promotionCandidates.push({
            title: article.title,
            url: article.url,
            reason: `上昇トレンド（週間PV: ${article.weeklyPV}）— 勢いに乗せて拡散`,
            priority: "high",
            suggestedPlatform: "twitter",
            suggestedTiming: "平日12:00-13:00（昼休み）または 20:00-22:00（夜のゴールデンタイム）",
          });
        }

        // トップ記事でまだ宣伝していないもの
        for (const article of topArticles.slice(0, 2)) {
          const alreadyPromoted = crossPostMemories.some((m) => m.content.includes(article.title));
          if (!alreadyPromoted) {
            promotionCandidates.push({
              title: article.title,
              url: article.url,
              reason: `高PV記事（総PV: ${article.totalPV}）— まだSNS宣伝していない`,
              priority: "medium",
              suggestedPlatform: "twitter",
              suggestedTiming: "週末10:00-12:00（閲覧時間が長い傾向）",
            });
          }
        }

        // 戦略サマリー
        const strategy = {
          overview: risingArticles.length > 0
            ? "上昇トレンド記事を優先的にSNSで拡散し、さらなるPV増加を狙う"
            : "トップ記事の再宣伝でロングテールPVを獲得する",
          twitterConfigured: Boolean(getTwitterClient()),
          crossPostHistory: {
            totalAttempts: crossPostMemories.length,
            successes: successPosts,
            failures: failurePosts,
          },
          recommendations: [
            "記事公開直後（1時間以内）のツイートが最も効果的",
            `ターゲット「${voice.targetAudience}」が活発な時間帯を狙う`,
            "ハッシュタグは3-5個が最適（多すぎるとスパム判定リスク）",
            risingArticles.length > 0
              ? "上昇トレンド記事の関連ツイートを連投（スレッド形式）すると効果的"
              : "過去のトップ記事を定期的にリツイート/引用ツイートで再露出",
          ],
        };

        return createSuccessResponse({
          analyzedAt: new Date().toISOString(),
          strategy,
          promotionCandidates,
          editorialVoice: {
            targetAudience: voice.targetAudience,
            topicFocus: voice.topicFocus,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`宣伝戦略の提案に失敗しました: ${message}`);
      }
    }
  );
}
