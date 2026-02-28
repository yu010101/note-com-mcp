import { XStrategy } from "../types/analytics-types.js";
import { readJsonStore } from "./memory-store.js";

const X_STRATEGY_FILE = "x-strategy.json";

/**
 * デフォルトのX運用戦略（ファイル未設定時のフォールバック）
 */
export const DEFAULT_X_STRATEGY: XStrategy = {
  actionWeights: {
    positive: {
      retweet: 1.0,
      quote: 0.9,
      reply: 0.8,
      like: 0.5,
      bookmark: 0.4,
      profileClick: 0.3,
      linkClick: 0.2,
      dwell2min: 0.1,
    },
    negative: {
      block: -1.5,
      report: -2.0,
      mute: -1.0,
      notInterested: -0.5,
      unfollow: -0.3,
    },
  },
  postFormats: [
    {
      name: "contrarian",
      engagementScore: 90,
      template: "【逆説】{常識}と思っていませんか？\n\n実は{真実}。\n\n{根拠を3行で}",
      description: "常識への反論で注目を集める。最も高エンゲージメント。",
    },
    {
      name: "number_hook",
      engagementScore: 88,
      template: "{数字}つの{テーマ}をまとめました。\n\n{リスト概要}\n\n詳しくは👇",
      description: "具体的な数字で興味を引く。保存率が高い。",
    },
    {
      name: "list",
      engagementScore: 85,
      template: "{テーマ}で大事なこと：\n\n・{項目1}\n・{項目2}\n・{項目3}\n・{項目4}\n・{項目5}\n\n最後が一番重要です。",
      description: "箇条書きで読みやすく。スレッド展開にも向く。",
    },
    {
      name: "confession",
      engagementScore: 82,
      template: "正直に言います。\n\n{告白内容}。\n\nでも{転換}。\n\nそこから学んだのは{教訓}。",
      description: "自己開示で共感を生む。リプライ率が高い。",
    },
    {
      name: "before_after",
      engagementScore: 80,
      template: "【Before】{過去の状態}\n↓\n【After】{現在の状態}\n\nやったことは{アクション}だけ。",
      description: "変化を見せて説得力を出す。RT率が高い。",
    },
    {
      name: "question",
      engagementScore: 78,
      template: "{問いかけ}？\n\n自分は{自分の答え}だと思ってます。\n\nみなさんはどうですか？",
      description: "問いかけでリプライを誘導。エンゲージメント安定型。",
    },
    {
      name: "thread_hook",
      engagementScore: 75,
      template: "{衝撃的な一文}。\n\nスレッドで詳しく解説します🧵",
      description: "スレッド導入。フック→展開の2段構成。",
    },
    {
      name: "morning",
      engagementScore: 65,
      template: "おはようございます。\n\n{今日の気づき/宣言}。\n\n今日も{アクション}していきます。",
      description: "朝の挨拶投稿。安定したインプレッション。",
    },
  ],
  goldenHours: [7, 12, 18, 20, 21, 22],
  engagementMultipliers: {
    like: {
      media: 1.5,
      question: 1.2,
      thread: 1.0,
      link: 0.8,
      plainText: 1.0,
    },
    reply: {
      media: 1.0,
      question: 3.0,
      thread: 1.5,
      link: 0.5,
      plainText: 1.0,
    },
    repost: {
      media: 1.5,
      question: 0.8,
      thread: 2.0,
      link: 1.2,
      plainText: 0.8,
    },
  },
  engagementThresholds: {
    excellent: 0.05,
    good: 0.02,
    average: 0.01,
    poor: 0,
  },
  formatOptimization: {
    deprecateThreshold: 0.3,
    boostThreshold: 2.0,
  },
  spamKeywords: [
    "稼げる",
    "副業",
    "即金",
    "DM待ってます",
    "フォロバ100",
    "相互フォロー",
    "プレゼント企画",
    "無料配布",
    "限定公開",
    "今だけ",
    "月収",
    "不労所得",
  ],
  contentSignals: {
    questionMarkers: ["?", "？", "どう", "何", "なぜ", "いつ", "どこ", "誰", "どれ"],
    ctaMarkers: ["フォロー", "RT", "リツイート", "シェア", "教えて", "リプ", "引用"],
    shareableValueMarkers: ["まとめ", "一覧", "比較", "ランキング", "手順", "方法", "コツ", "ノウハウ"],
    controversialMarkers: ["ぶっちゃけ", "本音", "炎上", "賛否", "反論", "正直", "ぶった切り"],
  },
  negativeSignalRules: [
    { condition: "ハッシュタグ5個超", riskIncrease: 0.3 },
    { condition: "メンション3個超", riskIncrease: 0.2 },
    { condition: "外部リンク3個超", riskIncrease: 0.15 },
    { condition: "同一テキスト連投", riskIncrease: 0.5 },
    { condition: "スパムキーワード含有", riskIncrease: 0.4 },
  ],
  postTimingByAudience: {
    general: [7, 12, 18, 20, 22],
    business: [7, 8, 12, 18, 21],
    engineer: [9, 12, 21, 22, 23],
    creator: [10, 14, 20, 21, 22],
  },
};

/**
 * X運用戦略を読み込む
 * x-strategy.json が存在しない場合はデフォルト値を返す
 */
export function getXStrategy(): XStrategy {
  return readJsonStore<XStrategy>(X_STRATEGY_FILE, DEFAULT_X_STRATEGY);
}
