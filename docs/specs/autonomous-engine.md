# 設計書: 自律実行エンジン（Phase 2）

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────┐
│  n8n / 外部スケジューラ                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Cron毎朝9時│  │Cron毎週月│  │Cron毎月1日│              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │HTTP POST     │             │                     │
└───────┼──────────────┼─────────────┼─────────────────────┘
        ▼              ▼             ▼
┌─────────────────────────────────────────────────────────┐
│  MCP Server (HTTP :3000)                                 │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │autonomous-tools.ts│  │schedule-tools.ts │             │
│  │                    │  │                  │             │
│  │ run-autonomous-   │  │ manage-schedule  │             │
│  │   cycle           │  │ get-schedule     │             │
│  │ auto-generate-    │  │ export-n8n-      │             │
│  │   article         │  │   workflow       │             │
│  └──────┬───────────┘  └──────────────────┘             │
│         │                                                │
│  ┌──────┴───────────┐                                   │
│  │feedback-tools.ts  │                                   │
│  │                    │                                   │
│  │ run-feedback-loop │                                   │
│  └──────┬───────────┘                                   │
│         │ 内部呼び出し                                    │
│  ┌──────┴──────────────────────────────────────┐        │
│  │ 既存ツール群                                   │        │
│  │ memory-tools / pdca-tools / analytics-tools  │        │
│  │ voice-tools / calendar-tools / workflow-tools│        │
│  └──────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## 型定義

### ScheduleEntry（analytics-types.ts に追加）

```typescript
export interface ScheduleEntry {
  id: string;
  name: string;
  cron: string;           // "0 9 * * *" 形式
  workflow: string;        // 実行するツール名またはワークフロー名
  params: Record<string, unknown>;  // ツールに渡すパラメータ
  enabled: boolean;
  description: string;
  lastRun?: string;        // ISO日時
  createdAt: string;
}
```

## ツール詳細設計

---

### 1. `run-autonomous-cycle`（autonomous-tools.ts）

**目的**: 全自動PDCAサイクルを1コマンドで実行

**パラメータ**:
| 名前 | 型 | デフォルト | 説明 |
|------|------|---------|------|
| period | "week" \| "month" | "week" | 分析期間 |
| dryRun | boolean | false | trueでAPI呼び出しスキップ |

**処理フロー**:
```
Step 1: 記憶参照
  → readJsonStore("memory-data.json") で直近20件取得

Step 2: パフォーマンス分析
  → fetchAllStats("week"/"month"/"all")
  → computeTrends() + categorizeArticles()

Step 3: PDCA比較
  → readJsonStore("pdca-history.json") から直近2件で比較

Step 4: 編集方針確認
  → readEditorialVoice()

Step 5: 洞察生成
  → Step 1-4のデータを統合してサマリー生成
  → 上昇記事の共通点、下降記事の問題点、前回actItemsの反映状況

Step 6: 記憶保存
  → appendToJsonArray("memory-data.json", { type: "reflection", ... })

Step 7: アクション提案
  → データに基づいた具体的な次アクション3-5項目を返却
```

**返却値**:
```typescript
{
  executedAt: string;
  period: string;
  dryRun: boolean;
  steps: WorkflowStepResult[];
  summary: {
    totalPV: number;
    risingCount: number;
    decliningCount: number;
    topArticles: { title: string; pv: number }[];
    recentMemories: number;
    pdcaCyclesAvailable: number;
  };
  insights: string[];
  nextActions: string[];
  memoryRecorded: { id: string; timestamp: string } | null;
}
```

---

### 2. `auto-generate-article`（autonomous-tools.ts）

**目的**: データ駆動で記事テーマ・構成案を自動生成

**パラメータ**:
| 名前 | 型 | デフォルト | 説明 |
|------|------|---------|------|
| count | number | 3 | 生成するテーマ候補数 |

**処理フロー**:
```
Step 1: データ収集（並列）
  → fetchAllStats("month") — 月間パフォーマンス
  → readJsonStore("memory-data.json") — 成功パターン（type=insight）
  → readEditorialVoice() — 編集方針
  → noteApiRequest("/v2/hashtags") — トレンドハッシュタグ

Step 2: テーマ候補生成
  → PV上位記事の横展開テーマ
  → トレンドハッシュタグ活用テーマ
  → 編集方針のtopicFocus深掘りテーマ
  → 成功パターンの再現テーマ
  各テーマにスコアリング（PV実績 × トレンド一致 × 方針一致）

Step 3: 構成案生成
  → 各テーマに対して:
    - タイトル案（PV上位記事のパターンを参考）
    - 推奨構成（導入→本文→まとめ）
    - 推奨ハッシュタグ
    - 推奨投稿日（曜日・時間帯の最適化）
    - editorial-voice準拠チェック
```

**返却値**:
```typescript
{
  generatedAt: string;
  dataContext: {
    articlesAnalyzed: number;
    insightsReferenced: number;
    trendHashtags: string[];
  };
  candidates: {
    rank: number;
    score: number;
    theme: string;
    titleSuggestion: string;
    outline: string[];
    hashtags: string[];
    suggestedDate: string;
    reasoning: string;
    voiceAlignment: string;
  }[];
}
```

---

### 3. `manage-schedule`（schedule-tools.ts）

**目的**: 自動実行スケジュールの追加・更新・削除

**パラメータ**:
| 名前 | 型 | 説明 |
|------|------|------|
| action | "add" \| "update" \| "remove" \| "toggle" | 操作種別 |
| id | string? | update/remove/toggle時に指定 |
| name | string? | スケジュール名 |
| cron | string? | cron式（"0 9 * * *"） |
| workflow | string? | 実行するツール/ワークフロー名 |
| params | object? | ツールに渡すパラメータ |
| description | string? | 説明 |

**永続化**: `schedule-config.json`（memory-storeパターン）

---

### 4. `get-schedule`（schedule-tools.ts）

**目的**: 現在のスケジュール設定と次回実行予定を確認

**パラメータ**: なし

**返却値**:
```typescript
{
  schedules: ScheduleEntry[];
  summary: {
    totalSchedules: number;
    enabledCount: number;
    disabledCount: number;
  };
}
```

---

### 5. `export-n8n-workflow`（schedule-tools.ts）

**目的**: スケジュール設定からn8nインポート用JSONを生成

**パラメータ**:
| 名前 | 型 | デフォルト | 説明 |
|------|------|---------|------|
| mcpUrl | string | "http://localhost:3000/mcp" | MCPサーバーのURL |

**処理**:
- schedule-config.jsonの有効なスケジュールを読み込み
- 各スケジュールに対してn8nノード構成を生成:
  - Cron Trigger → HTTP Request (POST /mcp) → 必要に応じてWebhook通知
- n8nのworkflow JSON形式で出力

---

### 6. `run-feedback-loop`（feedback-tools.ts）

**目的**: 記憶＋PDCA＋現状データから次アクション自動提案

**パラメータ**:
| 名前 | 型 | デフォルト | 説明 |
|------|------|---------|------|
| dryRun | boolean | false | trueでAPI呼び出しスキップ |

**処理フロー**:
```
Step 1: 記憶取得
  → readJsonStore("memory-data.json") — 直近20件
  → type=decisionの記憶から「前回の判断」を抽出

Step 2: PDCA履歴取得
  → readJsonStore("pdca-history.json") — 直近サイクル
  → actItemsから「やるべきだったこと」を抽出

Step 3: 現状パフォーマンス取得（dryRun=false時）
  → fetchAllStats("week") + computeTrends()
  → 前回比較可能な場合は差分を算出

Step 4: 突合分析
  → 前回の判断(decision) vs 実際の結果(performance)
  → PDCAのactItems vs 実行状況
  → 成功パターン(insight) vs 現在のトレンド

Step 5: アクション提案生成
  → 優先度付きで3-5項目
  → 各項目に根拠（どのデータから導出されたか）を付与

Step 6: 記憶保存
  → appendToJsonArray("memory-data.json", { type: "decision", ... })
```

**返却値**:
```typescript
{
  executedAt: string;
  dryRun: boolean;
  context: {
    memoriesReviewed: number;
    pdcaCyclesReviewed: number;
    currentPerformance: { totalPV: number; risingCount: number } | null;
  };
  analysis: {
    previousDecisions: string[];
    unfinishedActions: string[];
    currentStrengths: string[];
    currentWeaknesses: string[];
  };
  nextActions: {
    priority: "high" | "medium" | "low";
    action: string;
    reasoning: string;
  }[];
  memoryRecorded: { id: string; timestamp: string } | null;
}
```

## プロンプト追加（prompts.ts）

### `autonomous-cycle`
```
noteアカウントの完全自律サイクルを実行してください。
run-autonomous-cycleを実行し、結果に基づいて：
1. auto-generate-articleでテーマ候補を生成
2. 最も有望なテーマでcreate-draft（下書き作成）を提案
3. run-feedback-loopで次回への学びを記録
```

### `daily-routine`
```
noteアカウントの日次ルーティンを実行してください。
1. run-autonomous-cycle period=week で現状把握
2. 下書きがあればpublish-readinessチェック
3. run-feedback-loopで今日のアクション決定
4. 結果をsend-reportで通知
```

## ファイル構成

```
src/
├── types/
│   └── analytics-types.ts     ← ScheduleEntry追加
├── tools/
│   ├── autonomous-tools.ts    ← NEW: run-autonomous-cycle, auto-generate-article
│   ├── schedule-tools.ts      ← NEW: manage-schedule, get-schedule, export-n8n-workflow
│   ├── feedback-tools.ts      ← NEW: run-feedback-loop
│   └── index.ts               ← 3モジュール追加
├── prompts/
│   └── prompts.ts             ← 2プロンプト追加
└── note-mcp-server.ts         ← 3モジュールimport+register
```
