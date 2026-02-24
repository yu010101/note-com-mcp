import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, handleApiError } from "../utils/error-handler.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { PDCAReport } from "../types/analytics-types.js";

export function registerAnalyticsTools(server: McpServer) {
  server.tool(
    "analyze-content-performance",
    "コンテンツパフォーマンスをPDCA形式で分析する。週間・月間・全期間のPVデータからトレンドを算出し、上昇/安定/下降に分類したレポートを生成する。",
    {
      period: z
        .enum(["week", "month", "all"])
        .default("month")
        .describe("分析期間（week: 週間, month: 月間, all: 全期間）"),
      topN: z
        .number()
        .default(10)
        .describe("上位・下位に表示する記事数"),
    },
    async ({ period, topN }) => {
      try {
        // 並列で週間・月間・全期間のPVデータを取得
        const [weeklyRaw, monthlyRaw, allRaw] = await Promise.all([
          fetchAllStats("week"),
          fetchAllStats("month"),
          fetchAllStats("all"),
        ]);

        // Map化
        const weeklyStats = new Map<string, number>();
        for (const s of weeklyRaw) {
          weeklyStats.set(s.noteId, s.readCount);
        }

        const monthlyStats = new Map<string, number>();
        for (const s of monthlyRaw) {
          monthlyStats.set(s.noteId, s.readCount);
        }

        const allStats = new Map<string, { title: string; key: string; user: string; readCount: number }>();
        for (const s of allRaw) {
          allStats.set(s.noteId, {
            title: s.title,
            key: s.key,
            user: s.user,
            readCount: s.readCount,
          });
        }

        // トレンド算出
        const trends = computeTrends(weeklyStats, monthlyStats, allStats);
        const { topArticles, risingArticles, decliningArticles } = categorizeArticles(trends, topN);

        const totalPV = trends.reduce((sum, t) => sum + t.totalPV, 0);
        const risingCount = trends.filter((t) => t.trend === "rising").length;
        const decliningCount = trends.filter((t) => t.trend === "declining").length;

        // PDCAレポート生成
        const report: PDCAReport = {
          period,
          summary: {
            totalArticles: trends.length,
            totalPV,
            averagePV: trends.length > 0 ? Math.round(totalPV / trends.length) : 0,
            risingCount,
            decliningCount,
          },
          plan: [
            risingCount > 0
              ? `上昇トレンドの${risingCount}記事のテーマを深掘りして新記事を計画`
              : "新しいテーマでの記事を計画",
            decliningCount > 0
              ? `下降トレンドの${decliningCount}記事をリライトまたはSEO改善`
              : "既存記事の品質維持を継続",
            "トップ記事のフォーマット・構成を新記事に活用",
          ],
          doActions: [
            "上昇トレンド記事のキーワード・構成を分析して次回記事に反映",
            "下降トレンド記事のタイトル・サムネイルを更新",
            "トップ記事からシリーズ展開を検討",
          ],
          check: [
            { metric: "総記事数", value: trends.length, status: trends.length > 10 ? "良好" : "要改善" },
            { metric: "総PV", value: totalPV, status: totalPV > 1000 ? "良好" : "要改善" },
            { metric: "上昇記事数", value: risingCount, status: risingCount > 0 ? "良好" : "注意" },
            { metric: "下降記事数", value: decliningCount, status: decliningCount < 5 ? "良好" : "要対策" },
          ],
          act: [
            risingCount > decliningCount
              ? "全体的に上昇傾向。現在の方針を継続しつつ投稿頻度を上げる"
              : "下降記事が多い。コンテンツ戦略の見直しが必要",
            "トップ記事のパターンを横展開する",
          ],
          topArticles,
          decliningArticles,
          risingArticles,
        };

        return createSuccessResponse(report);
      } catch (error) {
        return handleApiError(error, "コンテンツパフォーマンス分析");
      }
    }
  );
}
