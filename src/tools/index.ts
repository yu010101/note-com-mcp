import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./search-tools.js";
import { registerNoteTools } from "./note-tools.js";
import { registerUserTools } from "./user-tools.js";
import { registerMembershipTools } from "./membership-tools.js";
import { registerMagazineTools } from "./magazine-tools.js";
import { registerImageTools } from "./image-tools.js";
import { registerObsidianTools } from "./obsidian-tools.js";
import { registerPublishTools } from "./publish-tools.js";
import { registerNotionTools } from "./notion-tools.js";
import { registerAnalyticsTools } from "./analytics-tools.js";
import { registerNotificationTools } from "./notification-tools.js";
import { registerVoiceTools } from "./voice-tools.js";
import { registerCompetitorTools } from "./competitor-tools.js";
import { registerCalendarTools } from "./calendar-tools.js";
import { registerWorkflowTools } from "./workflow-tools.js";
import { registerMemoryTools } from "./memory-tools.js";
import { registerPdcaTools } from "./pdca-tools.js";
import { registerAutonomousTools } from "./autonomous-tools.js";
import { registerScheduleTools } from "./schedule-tools.js";
import { registerFeedbackTools } from "./feedback-tools.js";

/**
 * すべてのツールをMCPサーバーに登録する
 * @param server MCPサーバーインスタンス
 */
export function registerAllTools(server: McpServer): void {
  // 各カテゴリのツールを登録
  registerSearchTools(server);
  registerNoteTools(server);
  registerUserTools(server);
  registerMembershipTools(server);
  registerMagazineTools(server);
  registerImageTools(server);
  registerObsidianTools(server);
  registerPublishTools(server);
  registerNotionTools(server);

  // 自律エージェント機能
  registerAnalyticsTools(server);
  registerNotificationTools(server);
  registerVoiceTools(server);
  registerCompetitorTools(server);
  registerCalendarTools(server);
  registerWorkflowTools(server);

  // 記憶・PDCAサイクル
  registerMemoryTools(server);
  registerPdcaTools(server);

  // 自律実行エンジン
  registerAutonomousTools(server);
  registerScheduleTools(server);
  registerFeedbackTools(server);
}
