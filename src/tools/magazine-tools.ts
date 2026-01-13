import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import { formatMagazine } from "../utils/formatters.js";
import {
  createSuccessResponse,
  createAuthErrorResponse,
  handleApiError,
} from "../utils/error-handler.js";
import { hasAuth } from "../utils/auth.js";

export function registerMagazineTools(server: McpServer) {
  // 1. マガジン詳細取得ツール
  server.tool(
    "get-magazine",
    "マガジンの詳細情報を取得する",
    {
      magazineId: z.string().describe("マガジンID（例: m75081e161aeb）"),
    },
    async ({ magazineId }) => {
      try {
        const data = await noteApiRequest(`/v1/magazines/${magazineId}`);

        const magazineData = data.data || {};
        const formattedMagazine = formatMagazine(magazineData);

        return createSuccessResponse(formattedMagazine);
      } catch (error) {
        return handleApiError(error, "マガジン取得");
      }
    }
  );

  // 2. マガジンに記事を追加するツール
  server.tool(
    "add-magazine-note",
    "マガジンに記事を追加する",
    {
      magazineId: z.string().describe("マガジンID（例: mxxxx）"),
      noteId: z.string().describe("記事ID（例: nxxxx）"),
    },
    async ({ magazineId, noteId }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        const data = await noteApiRequest(
          `/v1/our/magazines/${magazineId}/notes`,
          "POST",
          { id: noteId },
          true
        );

        return createSuccessResponse({
          message: "マガジンに記事を追加しました",
          data: data,
        });
      } catch (error) {
        return handleApiError(error, "マガジンへの記事追加");
      }
    }
  );

  // 3. マガジンから記事を削除するツール
  server.tool(
    "remove-magazine-note",
    "マガジンから記事を削除する",
    {
      magazineId: z.string().describe("マガジンID"),
      noteId: z.string().describe("記事ID"),
    },
    async ({ magazineId, noteId }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        const data = await noteApiRequest(
          `/v1/our/magazines/${magazineId}/notes/${noteId}`,
          "DELETE",
          null,
          true
        );

        return createSuccessResponse({
          message: "マガジンから記事を削除しました",
          data: data,
        });
      } catch (error) {
        return handleApiError(error, "マガジンからの記事削除");
      }
    }
  );
}
