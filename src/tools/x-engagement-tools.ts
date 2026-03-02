import { z } from "zod";
import { TwitterApi } from "twitter-api-v2";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "crypto";
import { env } from "../config/environment.js";
import {
  createSuccessResponse,
  createErrorResponse,
} from "../utils/error-handler.js";
import {
  recordInteraction,
  hasInteractedWith,
  getDailyActionCount,
} from "../utils/interaction-store.js";
import { scoreContent, checkShadowBan } from "../utils/engagement-analyzer.js";
import { canPostToday, recordPost } from "../utils/agent-runner.js";
import { appendToJsonArray } from "../utils/memory-store.js";
import { OutboundTarget, PostLogEntry, MemoryEntry } from "../types/analytics-types.js";

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

export function registerXEngagementTools(server: McpServer) {
  // ========== 1. search-tweets ==========
  server.tool(
    "search-tweets",
    "キーワードで最近のツイートを検索する。アウトバウンドエンゲージメントのターゲット発見用。",
    {
      query: z.string().describe("検索クエリ"),
      maxResults: z
        .number()
        .min(10)
        .max(100)
        .default(10)
        .describe("取得件数（10〜100）"),
    },
    async ({ query, maxResults }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。.envにAPI情報を設定してください。");
        }

        const result = await client.v2.search(query, {
          max_results: maxResults,
          "tweet.fields": [
            "public_metrics",
            "author_id",
            "created_at",
          ],
          expansions: ["author_id"],
        });

        const tweets = result.data?.data || [];
        const users = result.data?.includes?.users || [];

        const targets: OutboundTarget[] = tweets.map((tweet) => {
          const author = users.find((u) => u.id === tweet.author_id);
          return {
            tweetId: tweet.id,
            username: author?.username || "unknown",
            text: tweet.text,
            metrics: tweet.public_metrics
              ? {
                  likes: tweet.public_metrics.like_count,
                  retweets: tweet.public_metrics.retweet_count,
                  replies: tweet.public_metrics.reply_count,
                }
              : undefined,
          };
        });

        return createSuccessResponse({
          query,
          resultCount: targets.length,
          tweets: targets,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`ツイート検索に失敗しました: ${message}`);
      }
    }
  );

  // ========== 2. get-user-tweets ==========
  server.tool(
    "get-user-tweets",
    "指定ユーザーの直近ツイートを取得する。",
    {
      username: z.string().describe("取得対象のユーザー名（@なし）"),
      maxResults: z
        .number()
        .min(5)
        .max(100)
        .default(10)
        .describe("取得件数（5〜100）"),
    },
    async ({ username, maxResults }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。");
        }

        const user = await client.v2.userByUsername(username);
        if (!user.data) {
          return createErrorResponse(`ユーザー @${username} が見つかりません。`);
        }

        const timeline = await client.v2.userTimeline(user.data.id, {
          max_results: maxResults,
          "tweet.fields": [
            "public_metrics",
            "created_at",
          ],
        });

        const tweets = timeline.data?.data || [];
        const targets: OutboundTarget[] = tweets.map((tweet) => ({
          tweetId: tweet.id,
          username,
          text: tweet.text,
          metrics: tweet.public_metrics
            ? {
                likes: tweet.public_metrics.like_count,
                retweets: tweet.public_metrics.retweet_count,
                replies: tweet.public_metrics.reply_count,
              }
            : undefined,
        }));

        return createSuccessResponse({
          username,
          userId: user.data.id,
          resultCount: targets.length,
          tweets: targets,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`ユーザーツイート取得に失敗しました: ${message}`);
      }
    }
  );

  // ========== 3. like-tweet ==========
  server.tool(
    "like-tweet",
    "ツイートにいいねする。日次上限チェック付き。",
    {
      tweetId: z.string().describe("いいね対象のツイートID"),
    },
    async ({ tweetId }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。");
        }

        // 日次いいね上限チェック
        const maxLikes = env.AGENT_MAX_LIKES_PER_DAY;
        const todayLikes = getDailyActionCount("like");
        if (todayLikes >= maxLikes) {
          return createErrorResponse(
            `日次いいね上限 (${maxLikes}) に達しました（本日: ${todayLikes}件）`
          );
        }

        // 自分のIDを取得
        const me = await client.v2.me();
        const myId = me.data.id;

        // いいね実行
        await client.v2.like(myId, tweetId);

        // インタラクション記録
        recordInteraction({
          username: "",
          tweetId,
          action: "like",
          source: "outbound",
        });

        return createSuccessResponse({
          status: "liked",
          tweetId,
          todayLikes: todayLikes + 1,
          remaining: maxLikes - todayLikes - 1,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`いいねに失敗しました: ${message}`);
      }
    }
  );

  // ========== 4. reply-to-tweet ==========
  server.tool(
    "reply-to-tweet",
    "ツイートにリプライする。投稿予算チェック + インタラクション記録付き。",
    {
      tweetId: z.string().describe("リプライ対象のツイートID"),
      text: z.string().describe("リプライテキスト"),
    },
    async ({ tweetId, text }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。");
        }

        // 投稿予算チェック
        const budget = canPostToday();
        if (!budget.allowed) {
          return createErrorResponse(
            `投稿が制限されています: ${budget.reason}`
          );
        }

        // リプライ実行
        const result = await client.v2.reply(text, tweetId);

        // インタラクション記録
        recordInteraction({
          username: "",
          tweetId,
          action: "reply",
          context: text,
          source: "outbound",
        });

        // ポストログ記録
        const postEntry: PostLogEntry = {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          platform: "twitter",
          tweetId: result.data.id,
          text,
          type: "single",
        };
        recordPost(postEntry);

        return createSuccessResponse({
          status: "replied",
          replyTweetId: result.data.id,
          inReplyTo: tweetId,
          text,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`リプライに失敗しました: ${message}`);
      }
    }
  );

  // ========== 5. follow-user ==========
  server.tool(
    "follow-user",
    "ユーザーをフォローする。日次上限チェック + 重複防止付き。",
    {
      username: z.string().describe("フォロー対象のユーザー名（@なし）"),
    },
    async ({ username }) => {
      try {
        const client = getTwitterClient();
        if (!client) {
          return createErrorResponse("Twitter API未設定です。");
        }

        // 重複フォロー防止
        if (hasInteractedWith(username, "follow")) {
          return createErrorResponse(
            `@${username} は既にフォロー済みです（インタラクション記録あり）`
          );
        }

        // 日次フォロー上限チェック
        const maxFollows = env.AGENT_MAX_FOLLOWS_PER_DAY;
        const todayFollows = getDailyActionCount("follow");
        if (todayFollows >= maxFollows) {
          return createErrorResponse(
            `日次フォロー上限 (${maxFollows}) に達しました（本日: ${todayFollows}件）`
          );
        }

        // ユーザーID取得
        const targetUser = await client.v2.userByUsername(username);
        if (!targetUser.data) {
          return createErrorResponse(`ユーザー @${username} が見つかりません。`);
        }

        // 自分のIDを取得
        const me = await client.v2.me();
        const myId = me.data.id;

        // フォロー実行
        await client.v2.follow(myId, targetUser.data.id);

        // インタラクション記録
        recordInteraction({
          username,
          tweetId: "",
          action: "follow",
          source: "outbound",
        });

        return createSuccessResponse({
          status: "followed",
          username,
          userId: targetUser.data.id,
          todayFollows: todayFollows + 1,
          remaining: maxFollows - todayFollows - 1,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`フォローに失敗しました: ${message}`);
      }
    }
  );

  // ========== 6. score-tweet-draft ==========
  server.tool(
    "score-tweet-draft",
    "投稿前のテキストをスコアリングする。スパムリスク・シグナル検出・改善提案を返却。",
    {
      text: z.string().describe("スコアリング対象のテキスト"),
    },
    async ({ text }) => {
      try {
        const result = scoreContent(text);

        return createSuccessResponse({
          text,
          textLength: text.length,
          ...result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スコアリングに失敗しました: ${message}`);
      }
    }
  );

  // ========== 7. check-shadowban ==========
  server.tool(
    "check-shadowban",
    "シャドウバンの疑いをチェックする。直近投稿のインプレッション急落を検知。",
    {},
    async () => {
      try {
        const result = checkShadowBan();

        // 疑いありの場合、メモリに記録
        if (result.suspected) {
          const entry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: `シャドウバンの疑い検出: ${result.reason}`,
            source: "check-shadowban",
            tags: ["shadowban", "warning", "engagement"],
          };
          appendToJsonArray(MEMORY_FILE, entry);
        }

        return createSuccessResponse(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`シャドウバンチェックに失敗しました: ${message}`);
      }
    }
  );
}
