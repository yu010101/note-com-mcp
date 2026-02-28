import { z } from "zod";
import { randomUUID } from "crypto";
import { TwitterApi } from "twitter-api-v2";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { readEditorialVoice } from "../utils/voice-reader.js";
import { getXStrategy } from "../utils/x-strategy-reader.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { env } from "../config/environment.js";
import { MemoryEntry, PromotionEntry, PostLogEntry } from "../types/analytics-types.js";
import { canPostToday, getDailyPostCount, recordPost, getPostLog } from "../utils/agent-runner.js";

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

const THREADS_API_BASE = "https://graph.threads.net/v1.0";

async function postToThreads(text: string): Promise<{ posted: boolean; threadId?: string; error?: string }> {
  if (!env.THREADS_ACCESS_TOKEN || !env.THREADS_USER_ID) {
    return { posted: false, error: "Threads API未設定です。THREADS_ACCESS_TOKEN, THREADS_USER_ID を設定してください。" };
  }

  try {
    // Step 1: Create media container
    const containerRes = await fetch(
      `${THREADS_API_BASE}/${env.THREADS_USER_ID}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "TEXT",
          text,
          access_token: env.THREADS_ACCESS_TOKEN,
        }),
      }
    );

    if (!containerRes.ok) {
      const errBody = await containerRes.text();
      return { posted: false, error: `Container作成失敗: HTTP ${containerRes.status} - ${errBody}` };
    }

    const containerData = (await containerRes.json()) as { id: string };

    // Step 2: Publish
    const publishRes = await fetch(
      `${THREADS_API_BASE}/${env.THREADS_USER_ID}/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: env.THREADS_ACCESS_TOKEN,
        }),
      }
    );

    if (!publishRes.ok) {
      const errBody = await publishRes.text();
      return { posted: false, error: `Publish失敗: HTTP ${publishRes.status} - ${errBody}` };
    }

    const publishData = (await publishRes.json()) as { id: string };
    return { posted: true, threadId: publishData.id };
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return { posted: false, error: errMsg };
  }
}

export function registerPromotionTools(server: McpServer) {
  // --- check-post-budget ---
  server.tool(
    "check-post-budget",
    "今日の投稿残数とモード（dry-run-only / full-auto）を確認する。投稿前に必ず呼び出すことを推奨。",
    {},
    async () => {
      try {
        const budget = canPostToday();
        const dailyCount = getDailyPostCount();
        return createSuccessResponse({
          mode: budget.mode,
          allowed: budget.allowed,
          todayPosted: dailyCount,
          remaining: budget.remaining,
          maxPerDay: env.AGENT_MAX_TWEETS_PER_DAY,
          reason: budget.reason,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`投稿予算の確認に失敗しました: ${message}`);
      }
    }
  );

  // --- get-x-strategy ---
  server.tool(
    "get-x-strategy",
    "X運用戦略ナレッジを取得する。投稿フォーマット・タイミング・スコアリング基準・シグナル検出ルールなどを構造化データで返却。投稿判断前に参照推奨。",
    {
      section: z
        .enum(["all", "formats", "timing", "scoring", "signals"])
        .default("all")
        .describe("取得するセクション: all=全データ, formats=投稿フォーマット, timing=タイミング, scoring=スコアリング基準, signals=シグナル検出"),
    },
    async ({ section }) => {
      try {
        const strategy = getXStrategy();
        const now = new Date();
        const currentHour = now.getHours();
        const isGoldenHour = strategy.goldenHours.includes(currentHour);

        switch (section) {
          case "formats":
            return createSuccessResponse({
              section: "formats",
              postFormats: strategy.postFormats,
              note: "engagementScoreが高い順に推奨。テンプレートの{}部分を記事内容で置換して使用。",
            });

          case "timing":
            return createSuccessResponse({
              section: "timing",
              currentHour,
              isGoldenHour,
              goldenHours: strategy.goldenHours,
              postTimingByAudience: strategy.postTimingByAudience,
              recommendation: isGoldenHour
                ? `現在${currentHour}時 — ゴールデンアワーです。投稿に最適なタイミングです。`
                : `現在${currentHour}時 — 次のゴールデンアワーは${strategy.goldenHours.find((h) => h > currentHour) ?? strategy.goldenHours[0]}時です。`,
            });

          case "scoring":
            return createSuccessResponse({
              section: "scoring",
              actionWeights: strategy.actionWeights,
              engagementMultipliers: strategy.engagementMultipliers,
              engagementThresholds: strategy.engagementThresholds,
              formatOptimization: strategy.formatOptimization,
              note: "engagementThresholds: excellent≥5%, good≥2%, average≥1%。formatOptimization: deprecateThreshold=0.3倍以下で非推奨、boostThreshold=2.0倍以上で優先。",
            });

          case "signals":
            return createSuccessResponse({
              section: "signals",
              spamKeywords: strategy.spamKeywords,
              contentSignals: strategy.contentSignals,
              negativeSignalRules: strategy.negativeSignalRules,
              note: "投稿テキストにspamKeywordsが含まれるとスパム判定リスクが上昇。contentSignalsを活用してエンゲージメントを高める。",
            });

          case "all":
          default:
            return createSuccessResponse({
              section: "all",
              currentHour,
              isGoldenHour,
              strategy,
            });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`X運用戦略の取得に失敗しました: ${message}`);
      }
    }
  );

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
    "SNSにクロスポストする。Twitter/X・Threads・Webhook対応。投稿結果は記憶に自動記録。",
    {
      platform: z
        .enum(["twitter", "threads", "webhook"])
        .describe("投稿先（twitter: X/Twitter API v2, threads: Meta Threads API, webhook: SNS_WEBHOOK_URL経由）"),
      text: z.string().describe("投稿テキスト（generate-promotionの出力を使用推奨）"),
      articleTitle: z.string().optional().describe("元記事タイトル（記憶記録用）"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueで実際の投稿をスキップ"),
    },
    async ({ platform, text, articleTitle, dryRun }) => {
      try {
        let result: { posted: boolean; postId?: string; error?: string } = { posted: false };

        if (dryRun) {
          return createSuccessResponse({
            status: "dry_run",
            platform,
            text,
            charCount: text.length,
            message: "dryRunモード: 実際の投稿はスキップされました",
          });
        }

        // 投稿予算チェック
        const budget = canPostToday();
        if (!budget.allowed) {
          return createErrorResponse(
            `投稿が制限されています: ${budget.reason} (今日の投稿数: ${getDailyPostCount()}, 残数: ${budget.remaining})`
          );
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
                postId: tweet.data.id,
              };
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              result = { posted: false, error: errMsg };
            }
            break;
          }

          case "threads": {
            if (text.length > 500) {
              return createErrorResponse("Threadsの文字数制限（500文字）を超えています。");
            }
            const threadsResult = await postToThreads(text);
            result = {
              posted: threadsResult.posted,
              postId: threadsResult.threadId,
              error: threadsResult.error,
            };
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

        // 投稿ログに記録
        if (result.posted) {
          try {
            const postEntry: PostLogEntry = {
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              platform,
              tweetId: result.postId,
              text,
              articleTitle: articleTitle || undefined,
              type: "single",
            };
            recordPost(postEntry);
          } catch {
            // ログ保存失敗は無視
          }
        }

        // 記憶に記録
        try {
          const entry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: result.posted
              ? `${platform}にクロスポスト成功: 「${articleTitle || "記事"}」${result.postId ? ` (postId: ${result.postId})` : ""}`
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
            postId: result.postId,
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

        // X運用戦略を取得
        const xStrategy = getXStrategy();
        const now = new Date();
        const currentHour = now.getHours();
        const isGoldenHour = xStrategy.goldenHours.includes(currentHour);
        const topFormats = xStrategy.postFormats
          .sort((a, b) => b.engagementScore - a.engagementScore)
          .slice(0, 3);

        // 宣伝候補記事の選定
        const promotionCandidates: {
          title: string;
          url: string;
          reason: string;
          priority: "high" | "medium" | "low";
          suggestedPlatform: string;
          suggestedTiming: string;
          recommendedFormats: { name: string; engagementScore: number; template: string }[];
        }[] = [];

        // 上昇トレンド記事 = 勢いに乗せるべき
        for (const article of risingArticles.slice(0, 3)) {
          promotionCandidates.push({
            title: article.title,
            url: article.url,
            reason: `上昇トレンド（週間PV: ${article.weeklyPV}）— 勢いに乗せて拡散`,
            priority: "high",
            suggestedPlatform: "twitter",
            suggestedTiming: isGoldenHour
              ? `今が投稿チャンス（${currentHour}時はゴールデンアワー）`
              : `次のゴールデンアワー: ${xStrategy.goldenHours.find((h) => h > currentHour) ?? xStrategy.goldenHours[0]}時`,
            recommendedFormats: topFormats.map((f) => ({ name: f.name, engagementScore: f.engagementScore, template: f.template })),
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
              suggestedTiming: isGoldenHour
                ? `今が投稿チャンス（${currentHour}時はゴールデンアワー）`
                : `次のゴールデンアワー: ${xStrategy.goldenHours.find((h) => h > currentHour) ?? xStrategy.goldenHours[0]}時`,
              recommendedFormats: topFormats.map((f) => ({ name: f.name, engagementScore: f.engagementScore, template: f.template })),
            });
          }
        }

        // 戦略サマリー
        const strategy = {
          overview: risingArticles.length > 0
            ? "上昇トレンド記事を優先的にSNSで拡散し、さらなるPV増加を狙う"
            : "トップ記事の再宣伝でロングテールPVを獲得する",
          twitterConfigured: Boolean(getTwitterClient()),
          threadsConfigured: Boolean(env.THREADS_ACCESS_TOKEN && env.THREADS_USER_ID),
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
          xStrategyInsights: {
            currentHour,
            isGoldenHour,
            nextGoldenHour: isGoldenHour ? currentHour : (xStrategy.goldenHours.find((h) => h > currentHour) ?? xStrategy.goldenHours[0]),
            topFormats: topFormats.map((f) => ({ name: f.name, score: f.engagementScore, description: f.description })),
            engagementThresholds: xStrategy.engagementThresholds,
            spamWarning: xStrategy.spamKeywords.slice(0, 5).join(", ") + " 等のキーワードを避けること",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`宣伝戦略の提案に失敗しました: ${message}`);
      }
    }
  );

  // --- post-thread ---
  server.tool(
    "post-thread",
    "X/Twitterにスレッド（連続ツイート）を投稿する。2〜25件のツイート配列をスレッド形式で連投。dryRun対応、予算チェック、投稿記録付き。",
    {
      tweets: z
        .array(z.string().max(280))
        .min(2)
        .max(25)
        .describe("スレッドとして投稿するツイートの配列（2〜25件、各280文字以内）"),
      articleTitle: z.string().optional().describe("元記事タイトル（記録用）"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueで実際の投稿をスキップ"),
    },
    async ({ tweets, articleTitle, dryRun }) => {
      try {
        if (dryRun) {
          return createSuccessResponse({
            status: "dry_run",
            platform: "twitter",
            threadLength: tweets.length,
            tweets: tweets.map((t, i) => ({
              index: i + 1,
              text: t,
              charCount: t.length,
            })),
            message: "dryRunモード: 実際の投稿はスキップされました",
          });
        }

        // 予算チェック
        const budget = canPostToday();
        if (!budget.allowed) {
          return createErrorResponse(
            `投稿が制限されています: ${budget.reason}`
          );
        }

        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse(
            "Twitter API未設定です。環境変数 TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET を設定してください。"
          );
        }

        // スレッド投稿
        const threadPayload = tweets.map((text) => ({ text }));
        const threadResult = await client.v2.tweetThread(threadPayload);

        const tweetIds = threadResult.map((t) => t.data.id);

        // 投稿ログに記録
        try {
          const postEntry: PostLogEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            platform: "twitter",
            tweetId: tweetIds[0],
            text: tweets[0],
            articleTitle: articleTitle || undefined,
            type: "thread",
            threadTweetIds: tweetIds,
          };
          recordPost(postEntry);
        } catch {
          // ログ保存失敗は無視
        }

        // 記憶に記録
        try {
          const memEntry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: `Xスレッド投稿成功: ${tweets.length}ツイート${articleTitle ? ` 「${articleTitle}」` : ""} (先頭ID: ${tweetIds[0]})`,
            source: "post-thread",
            tags: ["cross-post", "twitter", "thread", "success"],
          };
          appendToJsonArray(MEMORY_FILE, memEntry);
        } catch {
          // 記憶保存失敗は無視
        }

        return createSuccessResponse({
          status: "posted",
          platform: "twitter",
          threadLength: tweets.length,
          tweetIds,
          firstTweetId: tweetIds[0],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スレッド投稿に失敗しました: ${message}`);
      }
    }
  );

  // --- post-tweet-with-image ---
  server.tool(
    "post-tweet-with-image",
    "画像付きツイートをX/Twitterに投稿する。ローカルファイルパスまたはURLから画像をアップロードし、テキストと一緒に投稿。dryRun対応。",
    {
      text: z.string().max(280).describe("ツイート本文（280文字以内）"),
      imagePath: z.string().describe("画像ファイルパス（ローカル絶対パス）またはURL"),
      articleTitle: z.string().optional().describe("元記事タイトル（記録用）"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueで実際の投稿をスキップ"),
    },
    async ({ text, imagePath, articleTitle, dryRun }) => {
      try {
        if (dryRun) {
          return createSuccessResponse({
            status: "dry_run",
            platform: "twitter",
            text,
            charCount: text.length,
            imagePath,
            message: "dryRunモード: 実際の投稿はスキップされました",
          });
        }

        // 予算チェック
        const budget = canPostToday();
        if (!budget.allowed) {
          return createErrorResponse(
            `投稿が制限されています: ${budget.reason}`
          );
        }

        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse(
            "Twitter API未設定です。環境変数を設定してください。"
          );
        }

        // 画像データの取得
        let imageBuffer: Buffer;
        if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
          const response = await fetch(imagePath);
          if (!response.ok) {
            return createErrorResponse(`画像のダウンロードに失敗しました: HTTP ${response.status}`);
          }
          const arrayBuf = await response.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuf);
        } else {
          const fs = await import("fs");
          if (!fs.existsSync(imagePath)) {
            return createErrorResponse(`画像ファイルが見つかりません: ${imagePath}`);
          }
          imageBuffer = fs.readFileSync(imagePath);
        }

        // 画像アップロード
        const mediaId = await client.v1.uploadMedia(imageBuffer, {
          mimeType: imagePath.endsWith(".png") ? "image/png" : "image/jpeg",
        });

        // ツイート投稿
        const tweet = await client.v2.tweet({
          text,
          media: { media_ids: [mediaId] },
        });

        // 投稿ログに記録
        try {
          const postEntry: PostLogEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            platform: "twitter",
            tweetId: tweet.data.id,
            text,
            articleTitle: articleTitle || undefined,
            type: "image",
            mediaIds: [mediaId],
          };
          recordPost(postEntry);
        } catch {
          // ログ保存失敗は無視
        }

        // 記憶に記録
        try {
          const memEntry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: `画像付きツイート投稿成功${articleTitle ? `: 「${articleTitle}」` : ""} (tweetId: ${tweet.data.id})`,
            source: "post-tweet-with-image",
            tags: ["cross-post", "twitter", "image", "success"],
          };
          appendToJsonArray(MEMORY_FILE, memEntry);
        } catch {
          // 記憶保存失敗は無視
        }

        return createSuccessResponse({
          status: "posted",
          platform: "twitter",
          tweetId: tweet.data.id,
          mediaId,
          charCount: text.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`画像付きツイート投稿に失敗しました: ${message}`);
      }
    }
  );

  // --- check-tweet-engagement ---
  server.tool(
    "check-tweet-engagement",
    "単一ツイートのエンゲージメント（いいね・RT・リプライ・インプレッション）を取得する。結果はメモリに自動記録。",
    {
      tweetId: z.string().describe("エンゲージメントを取得するツイートID"),
    },
    async ({ tweetId }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。");
        }

        const tweet = await client.v2.singleTweet(tweetId, {
          "tweet.fields": ["public_metrics", "created_at"],
        });

        const metrics = tweet.data.public_metrics;
        if (!metrics) {
          return createErrorResponse("メトリクスを取得できませんでした。");
        }

        const engagementData = {
          tweetId,
          createdAt: tweet.data.created_at,
          metrics: {
            likes: metrics.like_count,
            retweets: metrics.retweet_count,
            replies: metrics.reply_count,
            impressions: metrics.impression_count ?? 0,
          },
          engagementRate:
            metrics.impression_count && metrics.impression_count > 0
              ? (
                  ((metrics.like_count + metrics.retweet_count + metrics.reply_count) /
                    metrics.impression_count) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
        };

        // 記憶に記録
        try {
          const memEntry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: `ツイート ${tweetId} のエンゲージメント: いいね${metrics.like_count}, RT${metrics.retweet_count}, リプ${metrics.reply_count}, imp${metrics.impression_count ?? 0}`,
            source: "check-tweet-engagement",
            tags: ["engagement", "twitter", "metrics"],
            metadata: engagementData,
          };
          appendToJsonArray(MEMORY_FILE, memEntry);
        } catch {
          // 記憶保存失敗は無視
        }

        return createSuccessResponse(engagementData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`エンゲージメント取得に失敗しました: ${message}`);
      }
    }
  );

  // --- check-all-recent-engagement ---
  server.tool(
    "check-all-recent-engagement",
    "直近N日間の投稿を一括でエンゲージメント取得・集計する。合計いいね・平均エンゲージメント率を算出。",
    {
      days: z
        .number()
        .default(7)
        .describe("何日分の投稿を対象にするか（デフォルト: 7）"),
    },
    async ({ days }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。");
        }

        const recentPosts = getPostLog(days).filter(
          (p) => p.platform === "twitter" && p.tweetId
        );

        if (recentPosts.length === 0) {
          return createSuccessResponse({
            message: `直近${days}日間のTwitter投稿が見つかりませんでした。`,
            posts: [],
            summary: null,
          });
        }

        const results: {
          tweetId: string;
          text: string;
          articleTitle?: string;
          postedAt: string;
          type: string;
          metrics: { likes: number; retweets: number; replies: number; impressions: number };
          engagementRate: string;
        }[] = [];

        let totalLikes = 0;
        let totalRetweets = 0;
        let totalReplies = 0;
        let totalImpressions = 0;

        for (const post of recentPosts) {
          try {
            const tweet = await client.v2.singleTweet(post.tweetId!, {
              "tweet.fields": ["public_metrics"],
            });
            const m = tweet.data.public_metrics;
            if (m) {
              const likes = m.like_count;
              const retweets = m.retweet_count;
              const replies = m.reply_count;
              const impressions = m.impression_count ?? 0;

              totalLikes += likes;
              totalRetweets += retweets;
              totalReplies += replies;
              totalImpressions += impressions;

              results.push({
                tweetId: post.tweetId!,
                text: post.text.slice(0, 100),
                articleTitle: post.articleTitle,
                postedAt: post.timestamp,
                type: post.type,
                metrics: { likes, retweets, replies, impressions },
                engagementRate:
                  impressions > 0
                    ? (((likes + retweets + replies) / impressions) * 100).toFixed(2) + "%"
                    : "N/A",
              });
            }
          } catch {
            // 個別ツイートのエラーはスキップ
            results.push({
              tweetId: post.tweetId!,
              text: post.text.slice(0, 100),
              articleTitle: post.articleTitle,
              postedAt: post.timestamp,
              type: post.type,
              metrics: { likes: 0, retweets: 0, replies: 0, impressions: 0 },
              engagementRate: "取得エラー",
            });
          }
        }

        const summary = {
          period: `直近${days}日間`,
          totalPosts: recentPosts.length,
          totalLikes,
          totalRetweets,
          totalReplies,
          totalImpressions,
          averageEngagementRate:
            totalImpressions > 0
              ? (((totalLikes + totalRetweets + totalReplies) / totalImpressions) * 100).toFixed(2) + "%"
              : "N/A",
          averageLikesPerPost: recentPosts.length > 0
            ? (totalLikes / recentPosts.length).toFixed(1)
            : "0",
        };

        // 記憶に集計結果を記録
        try {
          const memEntry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "insight",
            content: `直近${days}日のエンゲージメント集計: ${recentPosts.length}投稿, 合計いいね${totalLikes}, 平均エンゲージメント率${summary.averageEngagementRate}`,
            source: "check-all-recent-engagement",
            tags: ["engagement", "twitter", "summary", "analytics"],
            metadata: summary,
          };
          appendToJsonArray(MEMORY_FILE, memEntry);
        } catch {
          // 記憶保存失敗は無視
        }

        return createSuccessResponse({
          posts: results,
          summary,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`一括エンゲージメント取得に失敗しました: ${message}`);
      }
    }
  );

  // --- repurpose-article-to-thread ---
  server.tool(
    "repurpose-article-to-thread",
    "note記事をXスレッド形式に変換する。記事タイトル+本文から280字以内のツイート配列を生成。フック（1ツイート目）+ 要点（中間）+ CTA+URL（最終）構成。",
    {
      articleTitle: z.string().describe("記事タイトル"),
      articleBody: z.string().describe("記事本文（プレーンテキストまたはMarkdown）"),
      articleUrl: z.string().describe("記事URL（最終ツイートのCTAに使用）"),
      maxTweets: z
        .number()
        .default(5)
        .describe("スレッドの最大ツイート数（デフォルト: 5）"),
    },
    async ({ articleTitle, articleBody, articleUrl, maxTweets }) => {
      try {
        const voice = readEditorialVoice();

        // ハッシュタグ生成
        const hashtags: string[] = [];
        for (const topic of voice.topicFocus.slice(0, 2)) {
          hashtags.push(`#${topic.replace(/\s+/g, "")}`);
        }
        hashtags.push("#note");
        const hashtagStr = hashtags.join(" ");

        // 本文を段落に分割
        const paragraphs = articleBody
          .split(/\n\n+/)
          .map((p) => p.replace(/\n/g, " ").trim())
          .filter((p) => p.length > 0);

        // フックツイート（1ツイート目）
        const hookMaxLen = 280 - 4; // "🧵" + 改行分
        let hookText = `🧵「${articleTitle}」\n\n`;
        if (paragraphs.length > 0) {
          const firstParagraph = paragraphs[0];
          const remaining = hookMaxLen - hookText.length;
          if (firstParagraph.length <= remaining) {
            hookText += firstParagraph;
          } else {
            hookText += firstParagraph.slice(0, remaining - 3) + "...";
          }
        }

        const threadTweets: string[] = [hookText];

        // 中間ツイート（要点を分割）
        const middleMaxLen = 275; // 番号表記の余白
        const remainingParagraphs = paragraphs.slice(1);
        let currentTweet = "";
        let tweetIndex = 2;

        for (const para of remainingParagraphs) {
          if (threadTweets.length >= maxTweets - 1) break; // 最終ツイート分を確保

          if (currentTweet.length + para.length + 2 <= middleMaxLen) {
            currentTweet += (currentTweet ? "\n\n" : "") + para;
          } else {
            if (currentTweet) {
              threadTweets.push(currentTweet);
              tweetIndex++;
              currentTweet = "";
            }
            if (para.length <= middleMaxLen) {
              currentTweet = para;
            } else {
              currentTweet = para.slice(0, middleMaxLen - 3) + "...";
            }
          }
        }
        if (currentTweet && threadTweets.length < maxTweets - 1) {
          threadTweets.push(currentTweet);
        }

        // 最終ツイート（CTA + URL + ハッシュタグ）
        const ctaTweet = `📝 続きはnoteで読めます👇\n\n${articleUrl}\n\n${hashtagStr}`;
        threadTweets.push(ctaTweet);

        return createSuccessResponse({
          status: "converted",
          articleTitle,
          articleUrl,
          threadLength: threadTweets.length,
          tweets: threadTweets.map((t, i) => ({
            index: i + 1,
            text: t,
            charCount: t.length,
            role: i === 0 ? "hook" : i === threadTweets.length - 1 ? "cta" : "point",
          })),
          hashtags,
          note: "post-thread ツールでこのスレッドを投稿できます",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`記事→スレッド変換に失敗しました: ${message}`);
      }
    }
  );
}
