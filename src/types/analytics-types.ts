export interface TrendData {
  articleId: string;
  title: string;
  url: string;
  weeklyPV: number;
  monthlyPV: number;
  totalPV: number;
  trend: "rising" | "stable" | "declining";
  likesCount: number;
  commentsCount: number;
}

export interface PDCAReport {
  period: string;
  summary: {
    totalArticles: number;
    totalPV: number;
    averagePV: number;
    risingCount: number;
    decliningCount: number;
  };
  plan: string[];
  doActions: string[];
  check: { metric: string; value: number; status: string }[];
  act: string[];
  topArticles: TrendData[];
  decliningArticles: TrendData[];
  risingArticles: TrendData[];
}

export interface EditorialVoice {
  // 基本7フィールド
  writingStyle: string;
  targetAudience: string;
  brandVoice: string;
  topicFocus: string[];
  avoidTopics: string[];
  toneKeywords: string[];
  examplePhrases: string[];
  // soul拡張（optional — 後方互換）
  personality?: {
    traits: string[];
    speakingStyle: string[];
    favorites: string[];
    dislikes: string[];
  };
  expertise?: {
    field: string;
    level: "beginner" | "intermediate" | "advanced" | "expert";
    keywords: string[];
  }[];
  values?: {
    coreBeliefs: string[];
    prohibitions: string[];
    guidelines: string;
  };
  styleGuide?: {
    punctuation: string;
    honorifics: string;
    narrative: string;
  };
}

export interface CompetitorReport {
  username: string;
  postingFrequency: number;
  averageLikes: number;
  topHashtags: string[];
  recentArticles: { title: string; likes: number; url: string }[];
  gaps: string[];
}

export interface ContentPlanEntry {
  suggestedDate: string;
  topicSuggestion: string;
  hashtags: string[];
  reasoning: string;
  priority: "high" | "medium" | "low";
}

export interface WorkflowStepResult {
  step: string;
  status: "success" | "skipped" | "error";
  data?: any;
  error?: string;
}

export interface MemoryEntry {
  id: string;
  timestamp: string;
  type: "observation" | "insight" | "decision" | "reflection";
  content: string;
  source: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface PDCACycleEntry {
  cycleId: string;
  startDate: string;
  endDate: string;
  period: "week" | "month";
  plan: string[];
  doActions: string[];
  checkResult: {
    totalPV: number;
    averagePV: number;
    risingCount: number;
    decliningCount: number;
    topArticles: { title: string; pv: number }[];
  };
  actItems: string[];
  completedAt: string;
}

export interface ScheduleEntry {
  id: string;
  name: string;
  cron: string;
  workflow: string;
  params: Record<string, unknown>;
  enabled: boolean;
  description: string;
  lastRun?: string;
  createdAt: string;
  agentMode?: AgentMode;
}

// --- エージェントモード ---
export type AgentMode =
  | "morning-check"        // 朝のPV確認 + 通知
  | "content-creation"     // 記事企画 + 下書き生成
  | "promotion"            // SNS宣伝テキスト生成 + 投稿
  | "pdca-review"          // 週次/月次PDCA振り返り
  | "engagement-check"     // 投稿のエンゲージメント確認
  | "full-auto";           // 上記すべてを状況に応じて実行

// --- エージェント目標 ---
export interface AgentGoal {
  weeklyPVTarget: number;
  monthlyArticleTarget: number;
  promotionFrequency: "daily" | "every-other-day" | "weekly";
  focusTopics: string[];
  customInstructions: string;
}

// --- エージェント実行ログ ---
export interface AgentCycleLog {
  id: string;
  mode: AgentMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  toolsCalled: string[];
  summary: string;
  costUsd: number;
  tokensUsed: number;
  success: boolean;
  error?: string;
}

export interface PostLogEntry {
  id: string;
  timestamp: string;
  platform: "twitter" | "threads" | "webhook";
  tweetId?: string;
  text: string;
  articleTitle?: string;
  type: "single" | "thread" | "image";
  mediaIds?: string[];
  threadTweetIds?: string[];
  engagementCheckedAt?: string;
  metrics?: {
    likes: number;
    retweets: number;
    replies: number;
    impressions: number;
  };
}

export interface PromotionEntry {
  platform: "twitter" | "threads" | "generic";
  text: string;
  hashtags: string[];
  url: string;
  articleTitle: string;
  generatedAt: string;
}

// --- X運用戦略ナレッジ ---
export interface XStrategy {
  // Xアルゴリズム — アクション重み
  actionWeights: {
    positive: Record<string, number>;
    negative: Record<string, number>;
  };
  // 投稿フォーマット（8種）
  postFormats: Array<{
    name: string;
    engagementScore: number;
    template: string;
    description: string;
  }>;
  // ゴールデンアワー
  goldenHours: number[];
  // エンゲージメント予測の乗数
  engagementMultipliers: {
    like: Record<string, number>;
    reply: Record<string, number>;
    repost: Record<string, number>;
  };
  // エンゲージメント評価基準
  engagementThresholds: {
    excellent: number;
    good: number;
    average: number;
    poor: number;
  };
  // フォーマット最適化
  formatOptimization: {
    deprecateThreshold: number;
    boostThreshold: number;
  };
  // NGワード（スパム判定リスク）
  spamKeywords: string[];
  // コンテンツシグナル検出マーカー
  contentSignals: {
    questionMarkers: string[];
    ctaMarkers: string[];
    shareableValueMarkers: string[];
    controversialMarkers: string[];
  };
  // ネガティブシグナルリスク条件
  negativeSignalRules: Array<{
    condition: string;
    riskIncrease: number;
  }>;
  // 投稿タイミング推奨
  postTimingByAudience: Record<string, number[]>;
}
