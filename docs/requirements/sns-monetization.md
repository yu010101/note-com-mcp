# 要件定義: SNSクロスポスト + マネタイズ自動化（Phase 3）

## ユーザーストーリー

AS A noteクリエイター
I WANT TO 記事公開と同時にSNSで自動宣伝し、有料記事の売上を最適化したい
SO THAT 手動のSNS投稿やマネタイズ戦略の試行錯誤をなくせる

## 背景

- Phase 1: 記憶・PDCA・Soul（実装済）
- Phase 2: 自律実行エンジン（実装済）
- 既存: 有料記事・メンバーシップのAPI対応済、Webhook通知（Slack/Discord/Telegram）済
- 不足: SNS宣伝テキスト生成、クロスポスト連携、収益分析、価格最適化

## 受入条件

### 機能要件

#### 1. SNS宣伝テキスト生成ツール `generate-promotion`
- [ ] 記事タイトル・URL・editorial-voiceからSNS投稿テキストを自動生成
- [ ] プラットフォーム別フォーマット: twitter（140字）、threads（500字）、generic（制限なし）
- [ ] ハッシュタグを自動付与（トレンド＋topicFocus）
- [ ] 成功パターン（記憶）を参考にしたキャッチコピー生成

#### 2. クロスポスト実行ツール `cross-post`
- [ ] 生成したテキストをWebhook経由で外部サービスに送信
- [ ] n8n/Zapier/IFTTT経由でTwitter/X、Threads等に中継可能な形式
- [ ] 投稿結果を記憶に記録（type: "observation"）
- [ ] 既存send-report基盤を活用し、SNS専用のペイロード形式を追加

#### 3. 収益分析ツール `analyze-revenue`
- [ ] 有料記事 vs 無料記事のPVパフォーマンス比較
- [ ] 価格帯別の分析（無料/低価格/中価格/高価格）
- [ ] メンバーシップ連携記事のパフォーマンス
- [ ] 収益最大化のための価格提案

#### 4. プロモーション戦略ツール `suggest-promotion-strategy`
- [ ] パフォーマンスデータ＋記憶＋editorial-voiceから最適な宣伝戦略を提案
- [ ] 「どの記事を」「いつ」「どのSNSで」宣伝すべきかを提案
- [ ] 過去のプロモーション結果（記憶）からの学習反映

#### 5. マネタイズワークフローツール `run-monetization-workflow`
- [ ] 収益分析→価格最適化→宣伝テキスト生成→クロスポスト の一連フロー
- [ ] dryRunモード対応
- [ ] 実行結果を記憶に自動記録

### 非機能要件
- 新規npm依存パッケージなし（既存のnode-fetch＋Webhookパターンで実現）
- Twitter API直接連携は不要（n8n/Zapier中継前提）
- 既存ツール30+個に影響を与えない

## 制約事項
- SNS投稿のAPI直接叩きはしない（Webhook中継パターン）
- 収益の実金額はnote.com APIから取得不可 — PV・いいね数ベースの間接分析
- 有料記事の価格設定変更はnote.com WebUI操作（Playwright）が必要 — 本フェーズでは提案のみ

## 変更ファイル一覧（予定）

| # | ファイル | 操作 | 内容 |
|---|---------|------|------|
| 1 | `src/tools/promotion-tools.ts` | 新規 | generate-promotion, cross-post, suggest-promotion-strategy |
| 2 | `src/tools/revenue-tools.ts` | 新規 | analyze-revenue, run-monetization-workflow |
| 3 | `src/types/analytics-types.ts` | 編集 | PromotionEntry型追加 |
| 4 | `src/config/environment.ts` | 編集 | SNS_WEBHOOK_URL追加 |
| 5 | `src/tools/index.ts` | 編集 | 2モジュール追加 |
| 6 | `src/note-mcp-server.ts` | 編集 | 2モジュールimport+register |
| 7 | `src/prompts/prompts.ts` | 編集 | monetization-review プロンプト追加 |

## 新規ツール一覧（5個）

| ツール | 分類 | 用途 |
|--------|------|------|
| `generate-promotion` | SNS | 記事宣伝テキストの自動生成 |
| `cross-post` | SNS | Webhook経由のクロスポスト実行 |
| `analyze-revenue` | マネタイズ | 有料/無料記事の収益分析 |
| `suggest-promotion-strategy` | 戦略 | データ駆動の宣伝戦略提案 |
| `run-monetization-workflow` | ワークフロー | 収益分析→宣伝の統合フロー |
