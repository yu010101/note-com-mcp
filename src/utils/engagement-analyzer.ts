import { FormatStats, PostLogEntry } from "../types/analytics-types.js";
import { readJsonStore, writeJsonStore } from "./memory-store.js";
import { getXStrategy } from "./x-strategy-reader.js";

const FORMAT_STATS_FILE = "format-stats.json";
const POST_LOG_FILE = "post-log.json";

// ========== フォーマット最適化 ==========

/**
 * フォーマット別成績を更新する
 */
export function updateFormatStats(
  formatName: string,
  metrics: NonNullable<PostLogEntry["metrics"]>
): void {
  const allStats = readJsonStore<FormatStats[]>(FORMAT_STATS_FILE, []);
  let stats = allStats.find((s) => s.formatName === formatName);

  if (!stats) {
    stats = {
      formatName,
      totalPosts: 0,
      totalLikes: 0,
      totalRetweets: 0,
      totalReplies: 0,
      totalImpressions: 0,
      avgEngagementRate: 0,
      lastUsed: new Date().toISOString(),
      status: "active",
    };
    allStats.push(stats);
  }

  stats.totalPosts += 1;
  stats.totalLikes += metrics.likes;
  stats.totalRetweets += metrics.retweets;
  stats.totalReplies += metrics.replies;
  stats.totalImpressions += metrics.impressions;
  stats.lastUsed = new Date().toISOString();

  // エンゲージメント率を再計算
  if (stats.totalImpressions > 0) {
    const totalEngagements =
      stats.totalLikes + stats.totalRetweets + stats.totalReplies;
    stats.avgEngagementRate = totalEngagements / stats.totalImpressions;
  }

  writeJsonStore(FORMAT_STATS_FILE, allStats);
}

/**
 * フォーマットを成績順にランキングする
 */
export function getFormatRanking(): FormatStats[] {
  const allStats = readJsonStore<FormatStats[]>(FORMAT_STATS_FILE, []);
  return [...allStats].sort(
    (a, b) => b.avgEngagementRate - a.avgEngagementRate
  );
}

/**
 * フォーマットを自動最適化する（deprecate/boost 切替）
 */
export function autoOptimizeFormats(): {
  deprecated: string[];
  boosted: string[];
} {
  const strategy = getXStrategy();
  const { deprecateThreshold, boostThreshold } = strategy.formatOptimization;
  const allStats = readJsonStore<FormatStats[]>(FORMAT_STATS_FILE, []);

  if (allStats.length === 0) {
    return { deprecated: [], boosted: [] };
  }

  // 全体平均エンゲージメント率
  const avgRate =
    allStats.reduce((sum, s) => sum + s.avgEngagementRate, 0) / allStats.length;

  const deprecated: string[] = [];
  const boosted: string[] = [];

  for (const stats of allStats) {
    if (avgRate > 0 && stats.totalPosts >= 3) {
      const ratio = stats.avgEngagementRate / avgRate;
      if (ratio <= deprecateThreshold) {
        stats.status = "deprecated";
        deprecated.push(stats.formatName);
      } else if (ratio >= boostThreshold) {
        stats.status = "boosted";
        boosted.push(stats.formatName);
      } else {
        stats.status = "active";
      }
    }
  }

  writeJsonStore(FORMAT_STATS_FILE, allStats);
  return { deprecated, boosted };
}

// ========== シャドウバン検出 ==========

/**
 * シャドウバンの疑いをチェックする（インプレッション急落検知）
 */
export function checkShadowBan(): {
  suspected: boolean;
  reason?: string;
  avgImpressions: number;
  recentImpressions: number;
} {
  const logs = readJsonStore<PostLogEntry[]>(POST_LOG_FILE, []);
  const now = new Date();

  // 直近14日の投稿を取得
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const recentLogs = logs.filter(
    (l) => l.timestamp >= fourteenDaysAgo.toISOString() && l.metrics
  );

  if (recentLogs.length < 5) {
    return {
      suspected: false,
      reason: "分析に十分な投稿データがありません（最低5件必要）",
      avgImpressions: 0,
      recentImpressions: 0,
    };
  }

  // 過去14日平均
  const allImpressions = recentLogs.map((l) => l.metrics!.impressions);
  const avgImpressions =
    allImpressions.reduce((sum, v) => sum + v, 0) / allImpressions.length;

  // 直近3日の投稿
  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const last3Days = recentLogs.filter(
    (l) => l.timestamp >= threeDaysAgo.toISOString()
  );

  if (last3Days.length === 0) {
    return {
      suspected: false,
      reason: "直近3日間に投稿がありません",
      avgImpressions,
      recentImpressions: 0,
    };
  }

  const recentAvg =
    last3Days.reduce((sum, l) => sum + l.metrics!.impressions, 0) /
    last3Days.length;

  // 10%以下に落ちた場合 suspected
  const ratio = avgImpressions > 0 ? recentAvg / avgImpressions : 1;
  const suspected = ratio <= 0.1;

  return {
    suspected,
    reason: suspected
      ? `インプレッションが急落しています（過去14日平均: ${Math.round(avgImpressions)} → 直近3日平均: ${Math.round(recentAvg)}、${(ratio * 100).toFixed(1)}%）`
      : undefined,
    avgImpressions: Math.round(avgImpressions),
    recentImpressions: Math.round(recentAvg),
  };
}

// ========== コンテンツスコアリング ==========

/**
 * 投稿テキストを事前スコアリングする（スパムリスク・シグナル検出）
 */
export function scoreContent(text: string): {
  score: number;
  signals: string[];
  spamRisk: number;
  recommendations: string[];
} {
  const strategy = getXStrategy();
  const signals: string[] = [];
  const recommendations: string[] = [];
  let score = 50; // ベーススコア
  let spamRisk = 0;

  // ポジティブシグナル検出
  const { questionMarkers, ctaMarkers, shareableValueMarkers, controversialMarkers } =
    strategy.contentSignals;

  if (questionMarkers.some((m) => text.includes(m))) {
    signals.push("質問・問いかけを含む");
    score += 15;
  }

  if (ctaMarkers.some((m) => text.includes(m))) {
    signals.push("CTAを含む");
    score += 10;
  }

  if (shareableValueMarkers.some((m) => text.includes(m))) {
    signals.push("共有価値のあるコンテンツ");
    score += 15;
  }

  if (controversialMarkers.some((m) => text.includes(m))) {
    signals.push("議論を呼ぶ表現を含む");
    score += 10;
  }

  // スパムキーワード検出
  const matchedSpamWords = strategy.spamKeywords.filter((kw) =>
    text.includes(kw)
  );
  if (matchedSpamWords.length > 0) {
    spamRisk += 0.4 * matchedSpamWords.length;
    signals.push(`スパムキーワード検出: ${matchedSpamWords.join(", ")}`);
    score -= 20 * matchedSpamWords.length;
    recommendations.push(
      `スパムリスクの高いキーワードを避けてください: ${matchedSpamWords.join(", ")}`
    );
  }

  // ネガティブシグナルルール
  const hashtagCount = (text.match(/#/g) || []).length;
  if (hashtagCount > 5) {
    spamRisk += 0.3;
    signals.push(`ハッシュタグ過多 (${hashtagCount}個)`);
    score -= 15;
    recommendations.push("ハッシュタグは3〜5個以内に抑えてください");
  }

  const mentionCount = (text.match(/@/g) || []).length;
  if (mentionCount > 3) {
    spamRisk += 0.2;
    signals.push(`メンション過多 (${mentionCount}個)`);
    score -= 10;
    recommendations.push("メンションは必要最小限にしてください");
  }

  const urlCount = (text.match(/https?:\/\//g) || []).length;
  if (urlCount > 3) {
    spamRisk += 0.15;
    signals.push(`外部リンク過多 (${urlCount}個)`);
    score -= 10;
    recommendations.push("外部リンクは1〜2個に抑えてください");
  }

  // テキスト長チェック
  if (text.length < 20) {
    score -= 10;
    recommendations.push("テキストが短すぎます。もう少し情報を追加してください");
  } else if (text.length >= 200 && text.length <= 280) {
    score += 5;
    signals.push("最適な文字数（200〜280文字）");
  }

  // スコアを0〜100に正規化
  score = Math.max(0, Math.min(100, score));
  spamRisk = Math.max(0, Math.min(1, spamRisk));

  // 総合レコメンデーション
  if (score >= 80) {
    recommendations.unshift("高品質な投稿です。このまま投稿してOKです");
  } else if (score >= 60) {
    recommendations.unshift("まずまずの品質です。改善の余地があります");
  } else {
    recommendations.unshift("品質に懸念があります。修正を検討してください");
  }

  return { score, signals, spamRisk, recommendations };
}
