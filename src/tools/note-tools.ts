import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import { formatNote, formatComment, formatLike } from "../utils/formatters.js";
import { 
  createSuccessResponse, 
  createErrorResponse, 
  createAuthErrorResponse,
  handleApiError 
} from "../utils/error-handler.js";
import { 
  hasAuth,
  buildAuthHeaders,
  getPreviewAccessToken,
} from "../utils/auth.js";
import { env } from "../config/environment.js";

export function registerNoteTools(server: McpServer) {
  // 1. 記事詳細取得ツール
  server.tool(
    "get-note",
    "記事の詳細情報を取得する",
    {
      noteId: z.string().describe("記事ID（例: n4f0c7b884789）"),
    },
    async ({ noteId }) => {
      try {
        const params = new URLSearchParams({
          draft: "true",
          draft_reedit: "false",
          ts: Date.now().toString()
        });
        
        const data = await noteApiRequest(
          `/v3/notes/${noteId}?${params.toString()}`, 
          "GET",
          null,
          true
        );

        const noteData = data.data || {};
        const formattedNote = formatNote(noteData);

        return createSuccessResponse(formattedNote);
      } catch (error) {
        return handleApiError(error, "記事取得");
      }
    }
  );

  // 2. コメント一覧取得ツール
  server.tool(
    "get-comments",
    "記事へのコメント一覧を取得する",
    {
      noteId: z.string().describe("記事ID"),
    },
    async ({ noteId }) => {
      try {
        const data = await noteApiRequest(`/v1/note/${noteId}/comments`);

        let formattedComments: any[] = [];
        if (data.comments) {
          formattedComments = data.comments.map(formatComment);
        }

        return createSuccessResponse({
          comments: formattedComments
        });
      } catch (error) {
        return handleApiError(error, "コメント取得");
      }
    }
  );

  // 3. スキ取得ツール
  server.tool(
    "get-likes",
    "記事のスキ一覧を取得する",
    {
      noteId: z.string().describe("記事ID"),
    },
    async ({ noteId }) => {
      try {
        const data = await noteApiRequest(`/v3/notes/${noteId}/likes`);

        let formattedLikes: any[] = [];
        if (data.data && data.data.likes) {
          formattedLikes = data.data.likes.map(formatLike);
        }

        return createSuccessResponse({
          likes: formattedLikes
        });
      } catch (error) {
        return handleApiError(error, "スキ一覧取得");
      }
    }
  );

  // 4. 記事下書き保存ツール
  server.tool(
    "post-draft-note",
    "下書き状態の記事を新規作成または更新する",
    {
      title: z.string().describe("記事のタイトル"),
      body: z.string().describe("記事の本文"),
      tags: z.array(z.string()).optional().describe("タグ（最大10個）"),
      id: z.string().optional().describe("既存の下書きID（既存の下書きを更新する場合）"),
    },
    async ({ title, body, tags, id }) => {
        let previewAccessToken: string | null = null;
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        if (id) { // 既存の下書きIDがある場合のみpreview_access_tokenを取得
          previewAccessToken = await getPreviewAccessToken(id);
          if (!previewAccessToken) {
            console.error(`Failed to get preview_access_token for noteId: ${id}. Proceeding without it for draft save.`);
            // トークン取得失敗時は、以前の挙動（トークンなし）で試行する
          }
        }

        console.error("下書き保存リクエスト内容:");

        // 試行1: 公式API形式で試行（参考: https://note.com/taku_sid/n/n1b1b7894e28f）
        try {
          console.error("試行1: 公式API形式 /api/v1/text_notes");
          
          // 参照記事に基づく正しいパラメータ形式
          const postData1: any = {
            name: title,  // 'title'ではなく'name'
            body: body,
            template_key: null  // 新規作成時に必要
          };
          
          // 更新時はstatusを追加し、template_keyを削除
          if (id) {
            postData1.status = "draft";
            delete postData1.template_key;
          }

          console.error(`リクエスト内容: ${JSON.stringify(postData1, null, 2)}`);

          let endpoint = "";
          let method: "POST" | "PUT";
          if (id) { // 既存記事の更新
            endpoint = `/v1/text_notes/${id}`;
            method = "PUT";
          } else { // 新規作成
            endpoint = `/v1/text_notes`;
            method = "POST";
          }

          const headers1 = buildAuthHeaders();
          if (previewAccessToken) {
            headers1['Authorization'] = `Bearer ${previewAccessToken}`;
          }
          const data = await noteApiRequest(endpoint, method, postData1, true, headers1);
          console.error(`成功: ${JSON.stringify(data, null, 2)}`);

          return createSuccessResponse({
            success: true,
            data: data,
            message: id ? "既存の記事を下書き保存しました" : "新しい記事を下書き保存しました",
            noteId: data.data?.key || id || data.id || null
          });
        } catch (error1) {
          console.error(`試行1でエラー: ${error1}`);

          // 試行2: 旧APIエンドポイント
          try {
            console.error("試行2: 旧APIエンドポイント");
            const postData2 = {
              title,
              body,
              tags: tags || [],
            };

            console.error(`リクエスト内容: ${JSON.stringify(postData2, null, 2)}`);

            const endpoint = id
              ? `/v1/text_notes/draft_save?id=${id}&user_id=${env.NOTE_USER_ID}`
              : `/v1/text_notes/draft_save?user_id=${env.NOTE_USER_ID}`;

            const headers2 = buildAuthHeaders();
            // 試行2ではpreviewAccessTokenを必須としない（旧APIのため互換性維持）
            // もし試行1で取得できていれば利用する形も考えられるが、一旦シンプルに
            const data = await noteApiRequest(endpoint, "POST", postData2, true, headers2);
            console.error(`成功: ${JSON.stringify(data, null, 2)}`);

            return createSuccessResponse({
              success: true,
              data: data,
              message: id ? "既存の記事を下書き保存しました" : "新しい記事を下書き保存しました",
              noteId: data.id || data.note_id || id || null
            });
          } catch (error2) {
            console.error(`試行2でエラー: ${error2}`);
            return createErrorResponse(
              `記事の投稿に失敗しました:\n試行1エラー: ${error1}\n試行2エラー: ${error2}\n\nセッションの有効期限が切れている可能性があります。.envファイルのCookie情報を更新してください。`
            );
          }
        }
      } catch (error) {
        console.error(`下書き保存処理全体でエラー: ${error}`);
        return handleApiError(error, "記事投稿");
      }
    }
  );

  // 5. 記事編集ツール（既存記事の編集）
  server.tool(
    "edit-note",
    "既存の記事を編集する",
    {
      noteId: z.string().describe("編集する記事ID（例: n4f0c7b884789）"),
      title: z.string().describe("記事のタイトル"),
      body: z.string().describe("記事の本文"),
      tags: z.array(z.string()).optional().describe("タグ（最大10個）"),
      isDraft: z.boolean().optional().default(true).describe("下書き状態で保存するか（trueの場合下書き、falseの場合は公開）"),
    },
    async ({ noteId, title, body, tags, isDraft }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        console.error(`記事編集リクエスト: ${noteId}`);

        // 先に記事情報を取得してみる
        try {
          const params = new URLSearchParams({
            draft: "true",
            draft_reedit: "false",
            ts: Date.now().toString()
          });
          
          await noteApiRequest(
            `/v3/notes/${noteId}?${params.toString()}`, 
            "GET",
            null,
            true
          );
        } catch (getError) {
          console.error(`記事情報取得エラー: ${getError}`);
          return createErrorResponse(`指定された記事が存在しないか、アクセスできません: ${noteId}`);
        }

        // 記事編集API - v3形式を試行
        try {
          let previewAccessToken: string | null = null;
          if (noteId) { // 既存記事の場合のみトークン取得を試みる
            try {
              previewAccessToken = await getPreviewAccessToken(noteId);
              if (previewAccessToken && env.DEBUG) {
                console.error(`edit-note: Preview access token obtained for note ${noteId}`);
              }
            } catch (tokenError) {
              console.error(`edit-note: Failed to get preview access token for note ${noteId}: ${tokenError}`);
              // トークン取得に失敗しても、処理を続行する（セッション認証で試みる）
            }
          }

          const postDataV3 = {
            title: title,
            body: body,
            status: isDraft ? "draft" : "published",
            tags: tags || [],
            publish_at: null,
            eyecatch_image: null,
            price: 0,
            is_magazine_note: false
          };

          const headersV3 = buildAuthHeaders();
          if (previewAccessToken) { // 取得できていればヘッダーに追加
            headersV3['Authorization'] = `Bearer ${previewAccessToken}`;
            if (env.DEBUG) console.error('edit-note: Authorization header set with previewAccessToken for V3 API');
          }

          // V3編集エンドポイント
          const endpointV3 = `/v3/notes/${noteId}/${isDraft ? 'draft' : 'publish'}`;
          const dataV3 = await noteApiRequest(endpointV3, "POST", postDataV3, true, headersV3);
          console.error(`V3 API 編集成功: ${JSON.stringify(dataV3, null, 2)}`);

          return createSuccessResponse({
            success: true,
            data: dataV3,
            message: isDraft ? "記事をV3 APIで下書き保存しました" : "記事をV3 APIで公開しました",
            noteId: noteId
          });
        } catch (errorV3) {
          console.error(`V3 API編集エラー: ${errorV3}`);
          
          // V3で失敗した場合、V1形式でフォールバック
          try {
            const postDataV1 = { // V1 uses a simpler payload
              title,
              body,
              tags: tags || [],
            };
            const headersV1 = buildAuthHeaders(); // V1は通常セッション認証のみ

            const endpointV1 = `/v1/text_notes/draft_save?id=${noteId}&user_id=${env.NOTE_USER_ID}`;
            const dataV1 = await noteApiRequest(endpointV1, "POST", postDataV1, true, headersV1);
            console.error(`V1 API 旧形式での編集成功: ${JSON.stringify(dataV1, null, 2)}`);

            return createSuccessResponse({
              success: true,
              data: dataV1,
              message: "記事を下書き状態で更新しました（V1 API旧形式使用）",
              noteId: noteId
            });
          } catch (errorV1) {
            console.error(`V1 API編集エラー (フォールバック試行後): ${errorV1}`);
            return createErrorResponse(
              `記事の編集に失敗しました:\nAttempted V3 API Error: ${errorV3}\nFallback V1 API Error: ${errorV1}\n\nセッションの有効期限が切れている可能性があります。.envファイルのCookie情報を更新してください。`
            );
          }
        }
      } catch (error) {
        console.error(`記事編集処理全体でエラー: ${error}`);
        return handleApiError(error, "記事編集");
      }
    }
  );

  // 6. 記事公開ツール
  server.tool(
    "publish-note",
    "下書き状態の記事を公開する",
    {
      noteId: z.string().describe("公開する記事ID"),
      title: z.string().optional().describe("公開時に変更する記事タイトル（省略可）"),
      body: z.string().optional().describe("公開時に変更する記事本文（省略可）"),
      tags: z.array(z.string()).optional().describe("公開時に設定するタグ（省略可）"),
    },
    async ({ noteId, title, body, tags }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        console.error(`記事公開リクエスト: ${noteId}`);

        // 記事情報を先に取得
        let currentNote;
        try {
          const params = new URLSearchParams({
            draft: "true",
            draft_reedit: "false",
            ts: Date.now().toString()
          });
          
          const noteData = await noteApiRequest(
            `/v3/notes/${noteId}?${params.toString()}`, 
            "GET",
            null,
            true
          );
          
          currentNote = noteData.data || {};
        } catch (getError) {
          console.error(`記事情報取得エラー: ${getError}`);
          return createErrorResponse(`指定された記事が存在しないか、アクセスできません: ${noteId}`);
        }

        // 公開APIリクエスト
        try {
          const postData = {
            title: title || currentNote.title,
            body: body || currentNote.body,
            status: "published",
            tags: tags || currentNote.tags || [],
            publish_at: null,
            eyecatch_image: currentNote.eyecatch_image || null,
            price: currentNote.price || 0,
            is_magazine_note: currentNote.is_magazine_note || false
          };

          const endpoint = `/v3/notes/${noteId}/publish`;
          
          const data = await noteApiRequest(endpoint, "POST", postData, true);
          console.error(`公開成功: ${JSON.stringify(data, null, 2)}`);

          return createSuccessResponse({
            success: true,
            data: data,
            message: "記事を公開しました",
            noteId: noteId,
            noteUrl: data.data?.url || `https://note.com/${env.NOTE_USER_ID}/n/${noteId}`
          });
        } catch (error) {
          console.error(`公開エラー: ${error}`);
          return createErrorResponse(
            `記事の公開に失敗しました: ${error}\n\nセッションの有効期限が切れている可能性があります。.envファイルのCookie情報を更新してください。`
          );
        }
      } catch (error) {
        console.error(`記事公開処理全体でエラー: ${error}`);
        return handleApiError(error, "記事公開");
      }
    }
  );

  // 7. コメント投稿ツール
  server.tool(
    "post-comment",
    "記事にコメントを投稿する",
    {
      noteId: z.string().describe("記事ID"),
      text: z.string().describe("コメント本文"),
    },
    async ({ noteId, text }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        const data = await noteApiRequest(`/v1/note/${noteId}/comments`, "POST", { text }, true);

        return createSuccessResponse({
          message: "コメントを投稿しました",
          data: data
        });
      } catch (error) {
        return handleApiError(error, "コメント投稿");
      }
    }
  );

  // 6. スキをつけるツール
  server.tool(
    "like-note",
    "記事にスキをする",
    {
      noteId: z.string().describe("記事ID"),
    },
    async ({ noteId }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        await noteApiRequest(`/v3/notes/${noteId}/likes`, "POST", {}, true);

        return createSuccessResponse({
          message: "スキをつけました"
        });
      } catch (error) {
        return handleApiError(error, "スキ");
      }
    }
  );

  // 7. スキを削除するツール
  server.tool(
    "unlike-note",
    "記事のスキを削除する",
    {
      noteId: z.string().describe("記事ID"),
    },
    async ({ noteId }) => {
      try {
        if (!hasAuth()) {
          return createAuthErrorResponse();
        }

        await noteApiRequest(`/v3/notes/${noteId}/likes`, "DELETE", {}, true);

        return createSuccessResponse({
          message: "スキを削除しました"
        });
      } catch (error) {
        return handleApiError(error, "スキ削除");
      }
    }
  );

  // 8. 自分の記事一覧（下書きを含む）取得ツール
  server.tool(
    "get-my-notes",
    "自分の記事一覧（下書きを含む）を取得する",
    {
      page: z.number().default(1).describe("ページ番号（デフォルト: 1）"),
      perPage: z.number().default(20).describe("1ページあたりの表示件数（デフォルト: 20）"),
      status: z.enum(["all", "draft", "public"]).default("all").describe("記事の状態フィルター（all:すべて, draft:下書きのみ, public:公開済みのみ）"),
    },
    async ({ page, perPage, status }) => {
      try {
        if (!env.NOTE_USER_ID) {
          return createErrorResponse("環境変数 NOTE_USER_ID が設定されていません。.envファイルを確認してください。");
        }

        const params = new URLSearchParams({
          page: page.toString(),
          per_page: perPage.toString(),
          draft: "true",
          draft_reedit: "false",
          ts: Date.now().toString()
        });

        if (status === "draft") {
          params.set("status", "draft");
        } else if (status === "public") {
          params.set("status", "public");
        }

        const data = await noteApiRequest(
          `/v2/note_list/contents?${params.toString()}`,
          "GET",
          null,
          true
        );

        if (env.DEBUG) {
          console.error(`API Response: ${JSON.stringify(data, null, 2)}`);
        }

        let formattedNotes: any[] = [];
        let totalCount = 0;

        if (data.data && data.data.notes && Array.isArray(data.data.notes)) {
          formattedNotes = data.data.notes.map((note: any) => {
            const isDraft = note.status === "draft";
            const noteKey = note.key || "";
            const noteId = note.id || "";
            
            const draftTitle = note.noteDraft?.name || "";
            const title = note.name || draftTitle || "(無題)";
            
            let excerpt = "";
            if (note.body) {
              excerpt = note.body.length > 100 ? note.body.substring(0, 100) + '...' : note.body;
            } else if (note.peekBody) {
              excerpt = note.peekBody;
            } else if (note.noteDraft?.body) {
              const textContent = note.noteDraft.body.replace(/<[^>]*>/g, '');
              excerpt = textContent.length > 100 ? textContent.substring(0, 100) + '...' : textContent;
            }
            
            const publishedAt = note.publishAt || note.publish_at || note.displayDate || note.createdAt || '日付不明';
            
            return {
              id: noteId,
              key: noteKey,
              title: title,
              excerpt: excerpt,
              publishedAt: publishedAt,
              likesCount: note.likeCount || 0,
              commentsCount: note.commentsCount || 0,
              status: note.status || "unknown",
              isDraft: isDraft,
              format: note.format || "",
              url: `https://note.com/${env.NOTE_USER_ID}/n/${noteKey}`,
              editUrl: `https://editor.note.com/notes/${noteId}/edit/`,
              hasDraftContent: note.noteDraft ? true : false,
              lastUpdated: note.noteDraft?.updatedAt || note.createdAt || "",
              user: {
                id: note.user?.id || env.NOTE_USER_ID,
                name: note.user?.name || note.user?.nickname || "",
                urlname: note.user?.urlname || env.NOTE_USER_ID
              }
            };
          });
        }

        totalCount = data.data?.totalCount || 0;

        return createSuccessResponse({
          total: totalCount,
          page: page,
          perPage: perPage,
          status: status,
          totalPages: Math.ceil(totalCount / perPage),
          hasNextPage: page * perPage < totalCount,
          hasPreviousPage: page > 1,
          draftCount: formattedNotes.filter((note: any) => note.isDraft).length,
          publicCount: formattedNotes.filter((note: any) => !note.isDraft).length,
          notes: formattedNotes
        });
      } catch (error) {
        return handleApiError(error, "記事一覧取得");
      }
    }
  );

  // 9. 記事編集ページを開くツール
  server.tool(
    "open-note-editor",
    "記事の編集ページを開く",
    {
      noteId: z.string().describe("記事ID（例: n1a2b3c4d5e6）"),
    },
    async ({ noteId }) => {
      try {
        if (!env.NOTE_USER_ID) {
          return createErrorResponse("環境変数 NOTE_USER_ID が設定されていません。.envファイルを確認してください。");
        }

        const editUrl = `https://editor.note.com/notes/${noteId}/edit/`;

        return createSuccessResponse({
          status: "success",
          editUrl: editUrl,
          message: `編集ページのURLを生成しました。以下のURLを開いてください：\n${editUrl}`
        });
      } catch (error) {
        return handleApiError(error, "編集ページURL生成");
      }
    }
  );
}