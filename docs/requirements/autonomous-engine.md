# 要件定義: 自律実行エンジン（Phase 2）

## ユーザーストーリー

AS A noteクリエイター
I WANT TO コンテンツ運用を完全自動化したい
SO THAT 人間の介入なしにPDCA→記事生成→投稿→学習が回り続ける

## 背景

Phase 1で「脳」（記憶・PDCA・Soul）を実装済み。
しかし現状はMCPツールが**受動型**（呼ばれたら動く）で、自律的に動く仕組みがない。
既存のHTTPトランスポート・n8n連携・Webhook通知基盤を活用し、**自走するエンジン**を追加する。

## 受入条件

### 機能要件

#### 1. 統合パイプラインツール `run-autonomous-cycle`
- [ ] 1コマンドで「分析→記憶参照→計画→実行→振り返り→記憶保存」を回す
- [ ] 各ステップの結果をstep-by-step形式で返却（既存WorkflowStepResultを再利用）
- [ ] dryRunモード対応（APIを叩かず手順のみ返す）
- [ ] 実行結果をmemory-data.jsonに自動記録（type: "reflection"）

#### 2. 記事自動生成ツール `auto-generate-article`
- [ ] パフォーマンスデータ＋記憶＋editorial-voiceから最適テーマを自動選定
- [ ] テーマ・構成案・推奨ハッシュタグ・推奨投稿日をJSON返却
- [ ] 記憶のget-success-patternsを参照して過去の成功パターンを反映
- [ ] 既存のpublish-toolsへの橋渡し情報（下書き作成に必要な全パラメータ）を含む

#### 3. スケジュール管理ツール `manage-schedule` / `get-schedule`
- [ ] スケジュール定義をschedule-config.jsonに永続化（memory-storeパターン）
- [ ] cronライクなスケジュール表現: 「毎朝9時にmorning-check」「毎週月曜にPDCAレビュー」
- [ ] 有効/無効の切り替え
- [ ] get-scheduleで現在の設定と次回実行予定を返却
- [ ] **実際のcron実行はn8n / 外部スケジューラに委譲**（MCPサーバーはスケジュール定義の管理のみ）

#### 4. フィードバックループツール `run-feedback-loop`
- [ ] get-memoriesで直近の記憶を取得
- [ ] get-pdca-historyで直近サイクルを参照
- [ ] analyze-content-performanceで現在のデータを取得
- [ ] 3つを突合して「次にやるべきこと」を3-5項目で返却
- [ ] 結果をrecord-memoryで自動保存（type: "decision"）

#### 5. n8nワークフローテンプレート生成 `export-n8n-workflow`
- [ ] manage-scheduleの設定からn8nインポート可能なJSONを生成
- [ ] Cron Trigger → HTTP Request → MCP Tool呼び出しの構成
- [ ] ユーザーがn8nにインポートするだけで自動運用が開始できる

### 非機能要件
- 既存ツール（17個 + Phase 1の7個）に影響を与えない
- 全新ツールはdryRunモードを持つ
- schedule-config.jsonは.gitignore対象
- エラー時はWebhook通知（既存send-report再利用）

## 制約事項
- MCPサーバーはステートレス — スケジューラ内蔵しない（n8n委譲）
- 記事本文の生成はLLMクライアント側の責務 — MCPツールはテーマ・構成・メタデータまで
- 新規npm依存パッケージの追加なし（既存依存のみで実装）

## 変更ファイル一覧（予定）

| # | ファイル | 操作 | 内容 |
|---|---------|------|------|
| 1 | `src/types/analytics-types.ts` | 編集 | ScheduleEntry型追加 |
| 2 | `src/tools/autonomous-tools.ts` | 新規 | run-autonomous-cycle, auto-generate-article |
| 3 | `src/tools/schedule-tools.ts` | 新規 | manage-schedule, get-schedule, export-n8n-workflow |
| 4 | `src/tools/feedback-tools.ts` | 新規 | run-feedback-loop |
| 5 | `src/tools/index.ts` | 編集 | 3モジュール追加登録 |
| 6 | `src/note-mcp-server.ts` | 編集 | 3モジュールimport+register |
| 7 | `src/prompts/prompts.ts` | 編集 | autonomous-cycle, daily-routine プロンプト追加 |
| 8 | `.gitignore` | 編集 | schedule-config.json追加 |

## 新規ツール一覧（5個）

| ツール | 分類 | 用途 |
|--------|------|------|
| `run-autonomous-cycle` | オーケストレーション | 全自動PDCAサイクル実行 |
| `auto-generate-article` | コンテンツ生成 | テーマ選定〜構成案の自動生成 |
| `manage-schedule` | スケジュール | 自動実行スケジュールの設定 |
| `get-schedule` | スケジュール | スケジュール確認 |
| `run-feedback-loop` | 学習 | 記憶→分析→次アクション提案 |

※ `export-n8n-workflow`は`schedule-tools.ts`内のツールとして実装
