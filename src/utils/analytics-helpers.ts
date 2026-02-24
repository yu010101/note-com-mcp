import { noteApiRequest } from "./api-client.js";
import { env } from "../config/environment.js";
import { TrendData } from "../types/analytics-types.js";

/**
 * PV統計を全ページ取得する
 */
export async function fetchAllStats(
  filter: "week" | "month" | "all"
): Promise<{ noteId: string; title: string; key: string; user: string; readCount: number }[]> {
  const results: { noteId: string; title: string; key: string; user: string; readCount: number }[] = [];
  let page = 1;
  const maxPages = 20;

  while (page <= maxPages) {
    try {
      const data = await noteApiRequest(
        `/v1/stats/pv?filter=${filter}&page=${page}`,
        "GET",
        null,
        true
      );

      // APIレスポンス構造を探索（note.com APIはバージョンで異なる場合がある）
      const responseData = data?.data || {};
      const notes =
        responseData.note_stats ||
        responseData.noteStats ||
        responseData.stats ||
        responseData.notes ||
        responseData.contents ||
        (Array.isArray(responseData) ? responseData : []);
      if (!Array.isArray(notes) || notes.length === 0) {
        if (env.DEBUG && page === 1) {
          console.error(
            `fetchAllStats: 未知のレスポンス構造 keys=${Object.keys(responseData).join(",")}`
          );
        }
        break;
      }

      for (const stat of notes) {
        results.push({
          noteId: String(stat.id || stat.note_id || stat.noteId || ""),
          title: stat.name || stat.title || "",
          key: stat.key || "",
          user: stat.user?.urlname || env.NOTE_USER_ID || "",
          readCount: stat.read_count || stat.readCount || 0,
        });
      }

      // 次ページがなければ終了
      if (notes.length < 10) break;
      page++;
    } catch (error) {
      if (env.DEBUG) {
        console.error(`fetchAllStats page=${page} error:`, error);
      }
      break;
    }
  }

  return results;
}

/**
 * ユーザーの記事を複数ページ取得する
 */
export async function fetchUserArticles(
  username: string,
  maxPages: number = 3
): Promise<any[]> {
  const articles: any[] = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await noteApiRequest(
        `/v2/creators/${encodeURIComponent(username)}/contents?kind=note&page=${page}`
      );

      const contents = data?.data?.contents || [];
      if (!Array.isArray(contents) || contents.length === 0) break;

      articles.push(...contents);

      if (contents.length < 10) break;

      // レート制限対策
      if (page < maxPages) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      if (env.DEBUG) {
        console.error(`fetchUserArticles ${username} page=${page} error:`, error);
      }
      break;
    }
  }

  return articles;
}

/**
 * 週間・月間・全期間のPVデータからトレンドを算出する
 */
export function computeTrends(
  weeklyStats: Map<string, number>,
  monthlyStats: Map<string, number>,
  allStats: Map<string, { title: string; key: string; user: string; readCount: number }>
): TrendData[] {
  const trends: TrendData[] = [];

  for (const [noteId, allInfo] of allStats) {
    const weeklyPV = weeklyStats.get(noteId) || 0;
    const monthlyPV = monthlyStats.get(noteId) || 0;
    const totalPV = allInfo.readCount;

    // トレンド判定: weeklyPV / (monthlyPV / 4) の比率
    let trend: "rising" | "stable" | "declining" = "stable";
    if (monthlyPV > 0) {
      const weeklyExpected = monthlyPV / 4;
      const ratio = weeklyPV / weeklyExpected;
      if (ratio > 1.2) {
        trend = "rising";
      } else if (ratio < 0.8) {
        trend = "declining";
      }
    } else if (weeklyPV > 0) {
      trend = "rising";
    }

    const username = allInfo.user || env.NOTE_USER_ID || "unknown";
    trends.push({
      articleId: noteId,
      title: allInfo.title,
      url: `https://note.com/${username}/n/${allInfo.key}`,
      weeklyPV,
      monthlyPV,
      totalPV,
      trend,
      likesCount: 0,
      commentsCount: 0,
    });
  }

  return trends;
}

/**
 * トレンドデータをカテゴリ分類する
 */
export function categorizeArticles(
  trends: TrendData[],
  topN: number = 10
): {
  topArticles: TrendData[];
  risingArticles: TrendData[];
  decliningArticles: TrendData[];
} {
  const sorted = [...trends].sort((a, b) => b.totalPV - a.totalPV);

  return {
    topArticles: sorted.slice(0, topN),
    risingArticles: trends
      .filter((t) => t.trend === "rising")
      .sort((a, b) => b.weeklyPV - a.weeklyPV)
      .slice(0, topN),
    decliningArticles: trends
      .filter((t) => t.trend === "declining")
      .sort((a, b) => a.weeklyPV - b.weeklyPV)
      .slice(0, topN),
  };
}
