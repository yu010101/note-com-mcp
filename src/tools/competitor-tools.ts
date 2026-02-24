import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import { formatNote } from "../utils/formatters.js";
import { createSuccessResponse, handleApiError } from "../utils/error-handler.js";
import { env } from "../config/environment.js";
import { fetchUserArticles } from "../utils/analytics-helpers.js";
import { CompetitorReport } from "../types/analytics-types.js";

/**
 * 記事群からハッシュタグを抽出する
 */
function extractHashtags(articles: any[]): string[] {
  const tagCounts = new Map<string, number>();
  for (const article of articles) {
    const hashtags = article.hashtags || article.hashtag_notes || [];
    for (const tag of hashtags) {
      const name = typeof tag === "string" ? tag : tag.hashtag?.name || tag.name || "";
      if (name) {
        tagCounts.set(name, (tagCounts.get(name) || 0) + 1);
      }
    }
  }
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);
}

export function registerCompetitorTools(server: McpServer) {
  server.tool(
    "monitor-competitors",
    "競合クリエイターの投稿頻度・エンゲージメント・ハッシュタグ傾向を分析し、自分のアカウントと比較するギャップ分析を実行する。",
    {
      competitors: z
        .array(z.string())
        .min(1)
        .max(5)
        .describe("競合のユーザー名（urlname）一覧（1〜5名）"),
      period: z
        .enum(["week", "month"])
        .default("month")
        .describe("分析期間"),
    },
    async ({ competitors, period }) => {
      try {
        const maxPages = period === "week" ? 1 : 2;

        // 自分のデータを取得
        let myArticles: any[] = [];
        if (env.NOTE_USER_ID) {
          myArticles = await fetchUserArticles(env.NOTE_USER_ID, maxPages);
        }

        const myFormatted = myArticles.map((a) => formatNote(a, env.NOTE_USER_ID, true, true));
        const myHashtags = extractHashtags(myArticles);
        const myAvgLikes =
          myFormatted.length > 0
            ? Math.round(myFormatted.reduce((sum, n) => sum + n.likesCount, 0) / myFormatted.length)
            : 0;

        // 競合のデータを順次取得（レート制限対策）
        const reports: CompetitorReport[] = [];

        for (const username of competitors) {
          await new Promise((resolve) => setTimeout(resolve, 500));

          try {
            // クリエイター情報取得
            let creatorInfo: any = {};
            try {
              const creatorData = await noteApiRequest(`/v2/creators/${encodeURIComponent(username)}`);
              creatorInfo = creatorData?.data || {};
            } catch {
              // 取得できなくても記事データだけで分析を続行
            }

            await new Promise((resolve) => setTimeout(resolve, 500));

            // 記事取得
            const articles = await fetchUserArticles(username, maxPages);
            const formatted = articles.map((a) => formatNote(a, username, true, true));
            const hashtags = extractHashtags(articles);

            const avgLikes =
              formatted.length > 0
                ? Math.round(formatted.reduce((sum, n) => sum + n.likesCount, 0) / formatted.length)
                : 0;

            // ギャップ分析: 競合がカバーして自分がカバーしていないハッシュタグ
            const gaps = hashtags.filter((tag) => !myHashtags.includes(tag));

            reports.push({
              username,
              postingFrequency: articles.length,
              averageLikes: avgLikes,
              topHashtags: hashtags,
              recentArticles: formatted.slice(0, 5).map((n) => ({
                title: n.title,
                likes: n.likesCount,
                url: n.url,
              })),
              gaps,
            });
          } catch (error) {
            if (env.DEBUG) {
              console.error(`competitor ${username} error:`, error);
            }
            reports.push({
              username,
              postingFrequency: 0,
              averageLikes: 0,
              topHashtags: [],
              recentArticles: [],
              gaps: [],
            });
          }
        }

        return createSuccessResponse({
          myProfile: {
            username: env.NOTE_USER_ID || "（未設定）",
            articlesAnalyzed: myFormatted.length,
            averageLikes: myAvgLikes,
            topHashtags: myHashtags,
          },
          competitors: reports,
          period,
          analysisDate: new Date().toISOString().split("T")[0],
        });
      } catch (error) {
        return handleApiError(error, "競合分析");
      }
    }
  );
}
