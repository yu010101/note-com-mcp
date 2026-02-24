import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import { createSuccessResponse, handleApiError } from "../utils/error-handler.js";
import { fetchAllStats } from "../utils/analytics-helpers.js";
import { ContentPlanEntry } from "../types/analytics-types.js";
import { readEditorialVoiceOrNull } from "../utils/voice-reader.js";

export function registerCalendarTools(server: McpServer) {
  server.tool(
    "generate-content-plan",
    "パフォーマンスデータとトレンドハッシュタグに基づいて、投稿カレンダー（日付・トピック案・ハッシュタグ・根拠）を自動生成する。",
    {
      period: z
        .enum(["week", "month"])
        .default("month")
        .describe("計画期間（week: 1週間, month: 1ヶ月）"),
      postsPerWeek: z
        .number()
        .default(3)
        .describe("週あたりの目標投稿数"),
    },
    async ({ period, postsPerWeek }) => {
      try {
        // 並列データ取得
        const [monthlyStats, hashtagData] = await Promise.all([
          fetchAllStats("month"),
          noteApiRequest("/v2/hashtags").catch(() => null),
        ]);

        // editorial-voice読み込み
        const voice = readEditorialVoiceOrNull();

        // トレンドハッシュタグ
        const trendHashtags: string[] = [];
        if (hashtagData?.data) {
          const tags = hashtagData.data.hashtags || hashtagData.data.trending_hashtags || [];
          for (const tag of (Array.isArray(tags) ? tags : [])) {
            const name = typeof tag === "string" ? tag : tag.name || tag.hashtag || "";
            if (name) trendHashtags.push(name);
          }
        }

        // PV上位記事のテーマを参考にする
        const topStats = [...monthlyStats]
          .sort((a, b) => b.readCount - a.readCount)
          .slice(0, 5);
        const topTitles = topStats.map((s) => s.title);

        // カレンダー生成
        const totalDays = period === "week" ? 7 : 30;
        const totalPosts = period === "week" ? postsPerWeek : postsPerWeek * 4;
        const interval = Math.max(1, Math.floor(totalDays / totalPosts));

        const today = new Date();
        const plan: ContentPlanEntry[] = [];

        const focusTopics = voice?.topicFocus || [];
        const avoidTopics = voice?.avoidTopics || [];

        for (let i = 0; i < totalPosts; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() + i * interval);
          const dateStr = date.toISOString().split("T")[0];
          const dayOfWeek = date.getDay();

          // トピック候補をローテーション
          let topicBase = "";
          let reasoning = "";
          let priority: "high" | "medium" | "low" = "medium";
          const hashtags: string[] = [];

          if (topTitles.length > 0 && i % 3 === 0) {
            // PVが高かったテーマの深掘り
            const ref = topTitles[i % topTitles.length];
            topicBase = `「${ref}」の関連テーマ・続編`;
            reasoning = "過去にPVが高かったテーマの横展開";
            priority = "high";
          } else if (trendHashtags.length > 0 && i % 3 === 1) {
            // トレンドハッシュタグ活用
            const tag = trendHashtags[i % trendHashtags.length];
            topicBase = `#${tag} に関するトピック`;
            hashtags.push(tag);
            reasoning = "現在のトレンドハッシュタグに合わせた記事";
            priority = "medium";
          } else if (focusTopics.length > 0) {
            // editorial-voiceの注力トピック
            const topic = focusTopics[i % focusTopics.length];
            topicBase = `${topic}に関する実践的な記事`;
            reasoning = "編集方針の注力トピックに基づく";
            priority = "medium";
          } else {
            topicBase = "新規トピック（テーマ未定）";
            reasoning = "参考データが少ないため、新しいテーマを探索";
            priority = "low";
          }

          // 追加ハッシュタグ
          if (trendHashtags.length > 0 && hashtags.length === 0) {
            hashtags.push(trendHashtags[Math.min(i, trendHashtags.length - 1)]);
          }
          if (focusTopics.length > 0) {
            hashtags.push(focusTopics[0]);
          }

          // 曜日に応じた補足
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            reasoning += "（週末：読者の閲覧時間が長い傾向）";
          }

          plan.push({
            suggestedDate: dateStr,
            topicSuggestion: topicBase,
            hashtags: [...new Set(hashtags)],
            reasoning,
            priority,
          });
        }

        return createSuccessResponse({
          period,
          postsPerWeek,
          totalPlannedPosts: plan.length,
          editorialVoice: voice
            ? { writingStyle: voice.writingStyle, targetAudience: voice.targetAudience }
            : null,
          trendHashtags: trendHashtags.slice(0, 10),
          referenceTopArticles: topTitles,
          calendar: plan,
        });
      } catch (error) {
        return handleApiError(error, "コンテンツカレンダー生成");
      }
    }
  );
}
