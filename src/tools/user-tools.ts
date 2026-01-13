import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import { formatUser, formatNote } from "../utils/formatters.js";
import { createSuccessResponse, handleApiError } from "../utils/error-handler.js";
import { env } from "../config/environment.js";

export function registerUserTools(server: McpServer) {
  // 1. ユーザー詳細取得ツール
  server.tool(
    "get-user",
    "ユーザーの詳細情報を取得する",
    {
      username: z.string().describe("ユーザー名（例: princess_11）"),
    },
    async ({ username }) => {
      try {
        const data = await noteApiRequest(`/v2/creators/${username}`);

        const userData = data.data || {};

        if (env.DEBUG) {
          console.error(`User API Response: ${JSON.stringify(data, null, 2)}`);
        }

        const formattedUser = formatUser(userData);

        return createSuccessResponse(formattedUser);
      } catch (error) {
        return handleApiError(error, "ユーザー情報取得");
      }
    }
  );

  // 2. ユーザーの記事一覧取得ツール
  server.tool(
    "get-user-notes",
    "ユーザーの記事一覧を取得する",
    {
      username: z.string().describe("ユーザー名"),
      page: z.number().default(1).describe("ページ番号"),
    },
    async ({ username, page }) => {
      try {
        const data = await noteApiRequest(
          `/v2/creators/${username}/contents?kind=note&page=${page}`
        );

        let formattedNotes: any[] = [];
        if (data.data && data.data.contents) {
          formattedNotes = data.data.contents.map((note: any) => formatNote(note, username));
        }

        return createSuccessResponse({
          total: data.data?.totalCount || 0,
          limit: data.data?.limit || 0,
          notes: formattedNotes,
        });
      } catch (error) {
        return handleApiError(error, "ユーザー記事一覧取得");
      }
    }
  );

  // 3. カテゴリー記事一覧取得ツール
  server.tool(
    "get-category-notes",
    "カテゴリーに含まれる記事一覧を取得する",
    {
      category: z.string().describe("カテゴリー名（例: tech）"),
      page: z.number().default(1).describe("ページ番号"),
      sort: z
        .enum(["new", "trend"])
        .default("new")
        .describe("ソート方法（new: 新着順, trend: 人気順）"),
    },
    async ({ category, page, sort }) => {
      try {
        const data = await noteApiRequest(
          `/v1/categories/${category}?note_intro_only=true&sort=${sort}&page=${page}`
        );

        let formattedNotes: any[] = [];
        if (data.data && data.data.notes && Array.isArray(data.data.notes)) {
          formattedNotes = data.data.notes.map((note: any) => ({
            id: note.id || "",
            title: note.name || "",
            excerpt: note.body
              ? note.body.length > 100
                ? note.body.substring(0, 100) + "..."
                : note.body
              : "本文なし",
            user: {
              nickname: note.user?.nickname || "",
              urlname: note.user?.urlname || "",
            },
            publishedAt: note.publishAt || "日付不明",
            likesCount: note.likeCount || 0,
            url: `https://note.com/${note.user?.urlname || ""}/n/${note.key || ""}`,
          }));
        }

        return createSuccessResponse({
          category,
          page,
          notes: formattedNotes,
        });
      } catch (error) {
        return handleApiError(error, "カテゴリー記事取得");
      }
    }
  );

  // 4. PV統計情報取得ツール
  server.tool(
    "get-stats",
    "ダッシュボードのPV統計情報を取得する",
    {
      filter: z.enum(["all", "day", "week", "month"]).default("all").describe("期間フィルター"),
      page: z.number().default(1).describe("ページ番号"),
      sort: z.enum(["pv", "date"]).default("pv").describe("ソート方法（pv: PV数順, date: 日付順）"),
    },
    async ({ filter, page, sort }) => {
      try {
        const data = await noteApiRequest(
          `/v1/stats/pv?filter=${filter}&page=${page}&sort=${sort}`,
          "GET",
          null,
          true
        );

        return createSuccessResponse(data);
      } catch (error) {
        return handleApiError(error, "統計情報取得");
      }
    }
  );

  // 5. その他の管理系ツール
  server.tool("list-categories", "カテゴリー一覧を取得する", {}, async () => {
    try {
      const data = await noteApiRequest(`/v2/categories`, "GET");
      return createSuccessResponse(data.data || data);
    } catch (error) {
      return handleApiError(error, "カテゴリー取得");
    }
  });

  server.tool("list-hashtags", "ハッシュタグ一覧を取得する", {}, async () => {
    try {
      const data = await noteApiRequest(`/v2/hashtags`, "GET");
      return createSuccessResponse(data.data || data);
    } catch (error) {
      return handleApiError(error, "ハッシュタグ一覧取得");
    }
  });

  server.tool(
    "get-hashtag",
    "ハッシュタグの詳細を取得する",
    { tag: z.string().describe("ハッシュタグ名") },
    async ({ tag }) => {
      try {
        const data = await noteApiRequest(`/v2/hashtags/${encodeURIComponent(tag)}`, "GET");
        return createSuccessResponse(data.data || data);
      } catch (error) {
        return handleApiError(error, "ハッシュタグ詳細取得");
      }
    }
  );

  server.tool("get-search-history", "検索履歴を取得する", {}, async () => {
    try {
      const data = await noteApiRequest(`/v2/search_histories`, "GET");
      return createSuccessResponse(data.data || data);
    } catch (error) {
      return handleApiError(error, "検索履歴取得");
    }
  });

  server.tool("list-contests", "コンテスト一覧を取得する", {}, async () => {
    try {
      const data = await noteApiRequest(`/v2/contests`, "GET");
      return createSuccessResponse(data.data || data);
    } catch (error) {
      return handleApiError(error, "コンテスト取得");
    }
  });

  server.tool("get-notice-counts", "通知件数を取得する", {}, async () => {
    try {
      const data = await noteApiRequest(`/v3/notice_counts`, "GET");
      return createSuccessResponse(data.data || data);
    } catch (error) {
      return handleApiError(error, "通知件数取得");
    }
  });
}
