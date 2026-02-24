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
  writingStyle: string;
  targetAudience: string;
  brandVoice: string;
  topicFocus: string[];
  avoidTopics: string[];
  toneKeywords: string[];
  examplePhrases: string[];
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
