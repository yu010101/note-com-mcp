import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import {
  formatMembershipSummary,
  formatMembershipPlan,
  formatMembershipNote,
} from "../utils/formatters.js";
import {
  createSuccessResponse,
  createAuthErrorResponse,
  handleApiError,
  safeExtractData,
  commonExtractors,
} from "../utils/error-handler.js";
import { hasAuth } from "../utils/auth.js";
import { env } from "../config/environment.js";

export function registerMembershipTools(server: McpServer) {
  // 1. 加入済みメンバーシップ一覧取得ツール
  server.tool("get-membership-summaries", "加入済みメンバーシップ一覧を取得する", {}, async () => {
    try {
      if (!hasAuth()) {
        return createAuthErrorResponse();
      }

      const data = await noteApiRequest("/v2/circle/memberships/summaries", "GET", null, true);

      if (env.DEBUG) {
        console.error(
          `\n===== FULL Membership Summaries API Response =====\n${JSON.stringify(data, null, 2)}`
        );
      }

      const rawSummaries = safeExtractData(data, commonExtractors.memberships);
      const formattedSummaries = rawSummaries.map(formatMembershipSummary);

      if (env.DEBUG) {
        console.error(
          `Returning real API data with ${formattedSummaries.length} formatted summaries`
        );
        if (formattedSummaries.length > 0) {
          console.error(
            `First formatted summary: ${JSON.stringify(formattedSummaries[0], null, 2)}`
          );
        }
      }

      return createSuccessResponse({
        total: formattedSummaries.length,
        summaries: formattedSummaries,
      });
    } catch (error) {
      return handleApiError(error, "メンバーシップ一覧取得");
    }
  });

  // 2. 自分のメンバーシッププラン一覧取得ツール
  server.tool("get-membership-plans", "自分のメンバーシッププラン一覧を取得する", {}, async () => {
    try {
      if (!hasAuth()) {
        return createAuthErrorResponse();
      }

      const data = await noteApiRequest("/v2/circle/plans", "GET", null, true);

      if (env.DEBUG) {
        console.error(
          `\n===== FULL Membership Plans API Response =====\n${JSON.stringify(data, null, 2)}`
        );
      }

      const rawPlans = safeExtractData(data, commonExtractors.plans);
      const formattedPlans = rawPlans.map(formatMembershipPlan);

      if (env.DEBUG) {
        console.error(`Formatted plans: ${formattedPlans.length} items`);
        if (formattedPlans.length > 0) {
          console.error(`First formatted plan: ${JSON.stringify(formattedPlans[0], null, 2)}`);
        }
      }

      return createSuccessResponse({
        total: formattedPlans.length,
        plans: formattedPlans,
      });
    } catch (error) {
      return handleApiError(error, "メンバーシッププラン取得");
    }
  });

  // 3. サークル情報取得ツール
  server.tool("get-circle-info", "サークル情報を取得する", {}, async () => {
    try {
      if (!hasAuth()) {
        return createAuthErrorResponse();
      }

      const data = await noteApiRequest("/v2/circle", "GET", null, true);

      if (env.DEBUG) {
        console.error(`\nCircle Info API Response:\n${JSON.stringify(data, null, 2)}`);
      }

      const circleData = data.data || {};

      const formattedCircleInfo = {
        id: circleData.id || "",
        name: circleData.name || "",
        description: circleData.description || "",
        urlname: circleData.urlname || "",
        iconUrl: circleData.icon_url || "",
        createdAt: circleData.created_at || "",
        updatedAt: circleData.updated_at || "",
        isPublic: circleData.is_public || false,
        planCount: circleData.plan_count || 0,
        memberCount: circleData.member_count || 0,
        noteCount: circleData.note_count || 0,
        userId: circleData.user_id || "",
      };

      return createSuccessResponse(formattedCircleInfo);
    } catch (error) {
      return handleApiError(error, "サークル情報取得");
    }
  });

  // 4. メンバーシップ記事一覧取得ツール
  server.tool(
    "get-membership-notes",
    "メンバーシップの記事一覧を取得する",
    {
      membershipKey: z.string().describe("メンバーシップキー（例: fed4670a87bc）"),
      page: z.number().default(1).describe("ページ番号"),
      perPage: z.number().default(20).describe("ページあたりの記事数"),
    },
    async ({ membershipKey, page, perPage }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        if (env.DEBUG) {
          console.error(
            `Getting membership notes for membershipKey: ${membershipKey}, page: ${page}, perPage: ${perPage}`
          );
        }

        const data = await noteApiRequest(
          `/v3/memberships/${membershipKey}/notes?page=${page}&per=${perPage}`,
          "GET",
          null,
          true
        );

        if (env.DEBUG) {
          console.error(
            `\n===== FULL Membership Notes API Response =====\n${JSON.stringify(data, null, 2)}`
          );
        }

        let formattedNotes: any[] = [];
        let totalCount = 0;
        let membershipInfo = {};

        if (data.data) {
          // notesプロパティがある場合
          if (data.data.notes && Array.isArray(data.data.notes)) {
            formattedNotes = data.data.notes.map(formatMembershipNote);
            totalCount =
              data.data.totalCount ||
              data.data.total_count ||
              data.data.total ||
              formattedNotes.length;
            membershipInfo = data.data.membership || data.data.circle || {};
          }
          // itemsプロパティがある場合
          else if (data.data.items && Array.isArray(data.data.items)) {
            formattedNotes = data.data.items.map(formatMembershipNote);
            totalCount =
              data.data.totalCount ||
              data.data.total_count ||
              data.data.total ||
              formattedNotes.length;
            membershipInfo = data.data.membership || data.data.circle || {};
          }
          // 配列が直接返される場合
          else if (Array.isArray(data.data)) {
            formattedNotes = data.data.map(formatMembershipNote);
            totalCount = formattedNotes.length;
          }
        }

        // メンバーシップ情報を整形
        const formattedMembership = {
          id: (membershipInfo as any)?.id || "",
          key: (membershipInfo as any)?.key || membershipKey || "",
          name: (membershipInfo as any)?.name || "",
          description: (membershipInfo as any)?.description || "",
          creatorName:
            (membershipInfo as any)?.creator?.nickname ||
            (membershipInfo as any)?.creatorName ||
            "",
          price: (membershipInfo as any)?.price || 0,
          memberCount:
            (membershipInfo as any)?.memberCount || (membershipInfo as any)?.member_count || 0,
          notesCount:
            (membershipInfo as any)?.notesCount || (membershipInfo as any)?.notes_count || 0,
        };

        return createSuccessResponse({
          total: totalCount,
          page: page,
          perPage: perPage,
          membership: formattedMembership,
          notes: formattedNotes,
        });
      } catch (error) {
        return handleApiError(error, "メンバーシップ記事取得");
      }
    }
  );

  // 5. テスト用メンバーシップサマリー取得ツール
  server.tool(
    "get-test-membership-summaries",
    "テスト用：加入済みメンバーシップ一覧をダミーデータで取得する",
    {},
    async () => {
      try {
        const dummySummaries = [
          {
            id: "membership-1",
            key: "dummy-key-1",
            name: "テストメンバーシップ 1",
            urlname: "test-membership-1",
            price: 500,
            creator: {
              id: "creator-1",
              nickname: "テストクリエイター 1",
              urlname: "test-creator-1",
              profileImageUrl: "https://example.com/profile1.jpg",
            },
          },
          {
            id: "membership-2",
            key: "dummy-key-2",
            name: "テストメンバーシップ 2",
            urlname: "test-membership-2",
            price: 1000,
            creator: {
              id: "creator-2",
              nickname: "テストクリエイター 2",
              urlname: "test-creator-2",
              profileImageUrl: "https://example.com/profile2.jpg",
            },
          },
        ];

        return createSuccessResponse({
          total: dummySummaries.length,
          summaries: dummySummaries,
        });
      } catch (error) {
        return handleApiError(error, "テストデータ取得");
      }
    }
  );

  // 6. テスト用メンバーシップ記事取得ツール
  server.tool(
    "get-test-membership-notes",
    "テスト用：メンバーシップの記事一覧をダミーデータで取得する",
    {
      membershipKey: z.string().describe("メンバーシップキー（例: dummy-key-1）"),
      page: z.number().default(1).describe("ページ番号"),
      perPage: z.number().default(20).describe("ページあたりの記事数"),
    },
    async ({ membershipKey, page, perPage }) => {
      try {
        const membershipData = {
          id: "membership-id",
          key: membershipKey,
          name: `テストメンバーシップ (${membershipKey})`,
          description: "これはテスト用のメンバーシップ説明です。",
          creatorName: "テストクリエイター",
          price: 500,
          memberCount: 100,
          notesCount: 30,
        };

        const dummyNotes = [];
        const startIndex = (page - 1) * perPage;
        const endIndex = startIndex + perPage;
        const totalNotes = 30;

        for (let i = startIndex; i < Math.min(endIndex, totalNotes); i++) {
          dummyNotes.push({
            id: `note-${i + 1}`,
            title: `テスト記事 ${i + 1}`,
            excerpt: `これはテスト記事 ${i + 1} の要約です。メンバーシップ限定コンテンツとなります。`,
            publishedAt: new Date(2025, 0, i + 1).toISOString(),
            likesCount: Math.floor(Math.random() * 100),
            commentsCount: Math.floor(Math.random() * 20),
            user: "テストクリエイター",
            url: `https://note.com/test-creator/n/n${i + 1}`,
            isMembersOnly: true,
          });
        }

        return createSuccessResponse({
          total: totalNotes,
          page: page,
          perPage: perPage,
          membership: membershipData,
          notes: dummyNotes,
        });
      } catch (error) {
        return handleApiError(error, "メンバーシップ記事取得");
      }
    }
  );
}
