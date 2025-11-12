import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import http from "http";

// 設定とユーティリティ
import { env, authStatus } from "./config/environment.js";
import { loginToNote } from "./utils/auth.js";
import { noteApiRequest } from "./utils/api-client.js";
import { buildAuthHeaders, hasAuth } from "./utils/auth.js";

// ツールとプロンプトの登録
import { registerAllTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/prompts.js";

// 下書き保存用のカスタムヘッダーを構築
function buildCustomHeaders(): { [key: string]: string } {
  const headers = buildAuthHeaders();
  headers["content-type"] = "application/json";
  headers["origin"] = "https://editor.note.com";
  headers["referer"] = "https://editor.note.com/";
  headers["x-requested-with"] = "XMLHttpRequest";
  return headers;
}

// MCPセッション管理
const sessions = new Map<string, any>();

// ツールリストを取得する関数
async function getToolsList() {
  // 実際のMCPサーバーからツールリストを取得
  return [
    {
      name: "search-notes",
      description: "note.comの記事を検索（新着順・人気順・急上昇でソート可能）",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索キーワード" },
          size: { type: "number", description: "取得件数（1-100）", default: 10 },
          sort: { type: "string", description: "ソート順（new/created/like）", default: "new" }
        },
        required: ["query"]
      }
    },
    {
      name: "get-note",
      description: "note.comの記事詳細を取得（下書きも取得可能）",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "記事ID（例: n4f0c7b884789）" }
        },
        required: ["noteId"]
      }
    },
    {
      name: "analyze-notes",
      description: "note.comの記事を分析（エンゲージメント、コンテンツ、価格分析）",
      inputSchema: {
        type: "object",
        properties: {
          noteIds: { type: "array", items: { type: "string" }, description: "分析対象の記事IDリスト" },
          analysisType: { type: "string", description: "分析タイプ（engagement/content/price/all）", default: "all" }
        },
        required: ["noteIds"]
      }
    },
    {
      name: "search-users",
      description: "note.comのユーザーを検索",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索キーワード" },
          size: { type: "number", description: "取得件数", default: 10 }
        },
        required: ["query"]
      }
    },
    {
      name: "get-user",
      description: "note.comのユーザー詳細を取得",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ユーザーID" }
        },
        required: ["userId"]
      }
    },
    {
      name: "get-user-notes",
      description: "note.comのユーザーの記事一覧を取得",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ユーザーID" },
          size: { type: "number", description: "取得件数", default: 10 }
        },
        required: ["userId"]
      }
    },
    {
      name: "post-draft-note",
      description: "note.comに下書き記事を投稿",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "記事タイトル" },
          body: { type: "string", description: "記事本文" },
          tags: { type: "array", items: { type: "string" }, description: "タグ（最大10個）" },
          id: { type: "string", description: "既存の下書きID（更新する場合）" }
        },
        required: ["title", "body"]
      }
    },
    {
      name: "edit-note",
      description: "既存の記事を編集する",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "記事ID" },
          title: { type: "string", description: "記事タイトル" },
          body: { type: "string", description: "記事本文" },
          tags: { type: "array", items: { type: "string" }, description: "タグ（最大10個）" },
          isDraft: { type: "boolean", description: "下書き状態", default: true }
        },
        required: ["id", "title", "body"]
      }
    },
    {
      name: "get-my-notes",
      description: "自分の記事一覧を取得（下書き含む）",
      inputSchema: {
        type: "object",
        properties: {
          size: { type: "number", description: "取得件数", default: 10 },
          includeDrafts: { type: "boolean", description: "下書きを含める", default: true }
        },
        required: []
      }
    },
    {
      name: "get-comments",
      description: "記事のコメント一覧を取得",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "記事ID" },
          size: { type: "number", description: "取得件数", default: 10 }
        },
        required: ["noteId"]
      }
    },
    {
      name: "post-comment",
      description: "記事にコメントを投稿",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "記事ID" },
          comment: { type: "string", description: "コメント内容" }
        },
        required: ["noteId", "comment"]
      }
    },
    {
      name: "like-note",
      description: "記事にスキをつける",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "記事ID" }
        },
        required: ["noteId"]
      }
    },
    {
      name: "unlike-note",
      description: "記事のスキを削除",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "記事ID" }
        },
        required: ["noteId"]
      }
    },
    {
      name: "search-magazines",
      description: "note.comのマガジンを検索",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索キーワード" },
          size: { type: "number", description: "取得件数", default: 10 }
        },
        required: ["query"]
      }
    },
    {
      name: "get-magazine",
      description: "note.comのマガジン詳細を取得",
      inputSchema: {
        type: "object",
        properties: {
          magazineId: { type: "string", description: "マガジンID" }
        },
        required: ["magazineId"]
      }
    },
    {
      name: "list-categories",
      description: "note.comのカテゴリー一覧を取得",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "list-hashtags",
      description: "note.comのハッシュタグ一覧を取得",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "get-stats",
      description: "記事のPV統計情報を取得",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "記事ID" }
        },
        required: ["noteId"]
      }
    },
    {
      name: "get-membership-summaries",
      description: "加入しているメンバーシップ一覧を取得",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "get-membership-plans",
      description: "自分のメンバーシッププラン一覧を取得",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "get-membership-notes",
      description: "メンバーシップ記事一覧を取得",
      inputSchema: {
        type: "object",
        properties: {
          size: { type: "number", description: "取得件数", default: 10 }
        },
        required: []
      }
    },
    {
      name: "get-circle-info",
      description: "サークル情報を取得",
      inputSchema: {
        type: "object",
        properties: {
          circleId: { type: "string", description: "サークルID" }
        },
        required: ["circleId"]
      }
    },
    {
      name: "get-notice-counts",
      description: "通知件数を取得",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "search-all",
      description: "note.com全体を検索（記事、ユーザー、ハッシュタグ）",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索キーワード" },
          size: { type: "number", description: "取得件数", default: 10 },
          sort: { type: "string", description: "ソート順", default: "new" }
        },
        required: ["query"]
      }
    }
  ];
}

/**
 * ◤◢◤◢◤◢◤◢◤◢◤◢◤◢
 * note API MCP Server (HTTP/SSE Transport)
 * 
 * Streamable HTTPトランスポート対応版
 * - Cursor、ChatGPT、OpenAI Responses APIからリモート接続可能
 * - SSE (Server-Sent Events) によるストリーミング対応
 * - HTTP越しのMCP通信をサポート
 * ◤◢◤◢◤◢◤◢◤◢◤◢◤◢
 */

// 環境変数から設定を取得
const PORT = parseInt(env.MCP_HTTP_PORT || "3000", 10);
const HOST = env.MCP_HTTP_HOST || "127.0.0.1";

// MCP サーバーインスタンスを作成
const server = new McpServer({
  name: "note-api",
  version: "2.0.0-http"
});

/**
 * サーバーの初期化処理
 */
async function initializeServer(): Promise<void> {
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  console.error("🚀 note API MCP Server v2.0.0 (HTTP) を初期化中...");
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

  // ツールの登録
  console.error("📝 ツールを登録中...");
  registerAllTools(server);
  
  // プロンプトの登録
  console.error("💭 プロンプトを登録中...");
  registerPrompts(server);

  console.error("✅ ツールとプロンプトの登録が完了しました");
}

/**
 * 認証処理の実行
 */
async function performAuthentication(): Promise<void> {
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  console.error("🔐 認証処理を実行中...");
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

  // 自動ログインの試行
  if (env.NOTE_EMAIL && env.NOTE_PASSWORD) {
    console.error("📧 メールアドレスとパスワードからログイン試行中...");
    const loginSuccess = await loginToNote();
    if (loginSuccess) {
      console.error("✅ ログイン成功: セッションCookieを取得しました");
    } else {
      console.error("❌ ログイン失敗: メールアドレスまたはパスワードが正しくない可能性があります");
    }
  }

  // 認証状態の表示
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  if (authStatus.hasCookie || authStatus.anyAuth) {
    console.error("🔓 認証情報が設定されています");
    console.error("✨ 認証が必要な機能も利用できます");
  } else {
    console.error("⚠️  警告: 認証情報が設定されていません");
    console.error("👀 読み取り機能のみ利用可能です");
    console.error("📝 投稿、コメント、スキなどの機能を使うには.envファイルに認証情報を設定してください");
  }
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
}

/**
 * HTTPサーバーの起動
 */
async function startServer(): Promise<void> {
  try {
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    console.error("🌟 note API MCP Server v2.0.0 (HTTP) を起動中...");
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

    // サーバーの初期化
    await initializeServer();
    
    // 認証処理
    await performAuthentication();
    
    // HTTPサーバーを作成
    const httpServer = http.createServer(async (req, res) => {
      // CORSヘッダーを設定
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      
      // プリフライトリクエストへの対応
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // ヘルスチェックエンドポイント
      if (req.url === "/health" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          server: "note-api-mcp",
          version: "2.0.0-http",
          transport: "SSE",
          authenticated: authStatus.hasCookie || authStatus.anyAuth
        }));
        return;
      }

      // MCPエンドポイント
      if (req.url?.startsWith("/mcp") || req.url?.startsWith("/sse")) {
        console.error(`📡 新しいMCP接続: ${req.socket.remoteAddress}`);
        
        // POSTリクエストの場合はJSON-RPCを処理
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk.toString();
          });
          
          req.on("end", async () => {
            try {
              const message = JSON.parse(body);
              console.error("📨 受信JSON-RPC:", message.method);
              
              // JSON-RPCレスポンスヘッダー
              res.writeHead(200, { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              });
              
              // initializeリクエストを処理
              if (message.method === "initialize") {
                const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                sessions.set(sessionId, { initialized: true });
                
                const response = {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {
                      tools: {},
                      prompts: {},
                      resources: {}
                    },
                    serverInfo: {
                      name: "note-api-mcp",
                      version: "2.0.0-http"
                    }
                  }
                };
                
                res.end(JSON.stringify(response));
                console.error("✅ Initializeレスポンスを送信しました");
                return;
              }
              
              // tools/listリクエストを処理
              if (message.method === "tools/list") {
                const toolsList = await getToolsList();
                const response = {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    tools: toolsList
                  }
                };
                
                res.end(JSON.stringify(response));
                console.error(`✅ Tools listレスポンスを送信しました (${toolsList.length}ツール)`);
                return;
              }
              
              // tools/callリクエストを処理
              if (message.method === "tools/call") {
                try {
                  const { name, arguments: args } = message.params;
                  console.error(`🔧 ツール実行リクエスト: ${name}`, args);
                  
                  // 実際のMCPサーバーからツールを実行
                  // ここでは実際のnote APIを呼び出す
                  let result;
                  
                  if (name === "search-notes") {
                    // search-notesツールの実装
                    const { query, size = 10, sort = "hot" } = args;
                    
                    // note APIを呼び出し（正しいエンドポイント）
                    const searchUrl = `/v3/searches?context=note&q=${encodeURIComponent(query)}&size=${size}&start=0&sort=${sort}`;
                    const data = await noteApiRequest(searchUrl, "GET", null, true);
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-note") {
                    // get-noteツールの実装
                    const { noteId } = args;
                    
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
                    
                    // 結果を見やすく整形
                    const noteData = data.data || {};
                    const formattedNote = {
                      id: noteData.id || "",
                      title: noteData.name || "",
                      body: noteData.body || "",
                      user: {
                        id: noteData.user?.id || "",
                        name: noteData.user?.nickname || "",
                        urlname: noteData.user?.urlname || "",
                        bio: noteData.user?.bio || "",
                      },
                      publishedAt: noteData.publishAt || "",
                      likesCount: noteData.likeCount || 0,
                      commentsCount: noteData.commentsCount || 0,
                      status: noteData.status || "",
                      url: `https://note.com/${noteData.user?.urlname || 'unknown'}/n/${noteData.key || ''}`
                    };
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(formattedNote, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-my-notes") {
                    // get-my-notesツールの実装
                    const { page = 1, perPage = 20, status = "all" } = args;
                    
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
                          url: `https://note.com/***USERNAME_REMOVED***/n/${noteKey}`,
                          editUrl: `https://note.com/***USERNAME_REMOVED***/n/${noteKey}/edit`,
                          hasDraftContent: note.noteDraft ? true : false,
                          lastUpdated: note.noteDraft?.updatedAt || note.createdAt || "",
                          user: {
                            id: note.user?.id || 3647265,
                            name: note.user?.name || note.user?.nickname || "",
                            urlname: note.user?.urlname || "***USERNAME_REMOVED***"
                          }
                        };
                      });
                    }
                    
                    totalCount = data.data?.totalCount || 0;
                    
                    const resultData = {
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
                    };
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(resultData, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-comments") {
                    // get-commentsツールの実装
                    const { noteId, size = 10 } = args;
                    
                    const data = await noteApiRequest(
                      `/v1/note/${noteId}/comments?size=${size}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "post-comment") {
                    // post-commentツールの実装
                    const { noteId, comment } = args;
                    
                    const data = await noteApiRequest(
                      `/v1/note/${noteId}/comments`, 
                      "POST", 
                      { comment: comment }, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "like-note") {
                    // like-noteツールの実装
                    const { noteId } = args;
                    
                    const data = await noteApiRequest(
                      `/v3/notes/${noteId}/like`, 
                      "POST", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "unlike-note") {
                    // unlike-noteツールの実装
                    const { noteId } = args;
                    
                    const data = await noteApiRequest(
                      `/v3/notes/${noteId}/unlike`, 
                      "POST", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "search-users") {
                    // search-usersツールの実装
                    const { query, size = 10 } = args;
                    
                    const data = await noteApiRequest(
                      `/v3/searches?context=user&q=${encodeURIComponent(query)}&size=${size}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-user") {
                    // get-userツールの実装
                    const { username } = args;
                    
                    const data = await noteApiRequest(
                      `/v2/creators/${username}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-user-notes") {
                    // get-user-notesツールの実装
                    const { username, page = 1 } = args;
                    
                    const data = await noteApiRequest(
                      `/v2/creators/${username}/contents?kind=note&page=${page}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "post-draft-note") {
                    // post-draft-noteツールの実装（11月8日成功版：2段階プロセス）
                    let { title, body, tags = [], id } = args;
                    
                    // 新規作成の場合、まず空の下書きを作成
                    if (!id) {
                      console.error("新規下書きを作成します...");
                      
                      const createData = {
                        body: "<p></p>",
                        body_length: 0,
                        name: title || "無題",
                        index: false,
                        is_lead_form: false
                      };
                      
                      const headers = buildCustomHeaders();
                      
                      const createResult = await noteApiRequest(
                        "/v1/text_notes",
                        "POST",
                        createData,
                        true,
                        headers
                      );
                      
                      if (createResult.data?.id) {
                        id = createResult.data.id.toString();
                        console.error(`下書き作成成功: ID=${id}`);
                      } else {
                        throw new Error("下書きの作成に失敗しました");
                      }
                    }
                    
                    // 下書きを更新
                    console.error(`下書きを更新します (ID: ${id})`);
                    
                    const updateData = {
                      body: body,
                      body_length: body.length,
                      name: title || "無題",
                      index: false,
                      is_lead_form: false
                    };
                    
                    const headers = await buildCustomHeaders();
                    
                    const data = await noteApiRequest(
                      `/v1/text_notes/draft_save?id=${id}&is_temp_saved=true`,
                      "POST",
                      updateData,
                      true,
                      headers
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify({
                          success: true,
                          message: "記事を下書き保存しました",
                          noteId: id,
                          editUrl: `https://editor.note.com/notes/${id}`,
                          data: data
                        }, null, 2)
                      }]
                    };
                    
                  } else if (name === "edit-note") {
                    // edit-noteツールの実装（参考: https://note.com/taku_sid/n/n1b1b7894e28f）
                    const { id, title, body, tags = [], isDraft = true } = args;
                    
                    // 参照記事に基づく正しいパラメータ形式
                    const postData = {
                      name: title,  // 'title'ではなく'name'
                      body: body,
                      status: isDraft ? "draft" : "published"
                    };
                    
                    const data = await noteApiRequest(
                      `/v1/text_notes/${id}`, 
                      "PUT", 
                      postData, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify({
                          success: true,
                          message: "記事を更新しました",
                          data: data
                        }, null, 2)
                      }]
                    };
                    
                  } else if (name === "search-magazines") {
                    // search-magazinesツールの実装
                    const { query, size = 10 } = args;
                    
                    const data = await noteApiRequest(
                      `/v3/searches?context=magazine&q=${encodeURIComponent(query)}&size=${size}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-magazine") {
                    // get-magazineツールの実装
                    const { magazineId } = args;
                    
                    const data = await noteApiRequest(
                      `/v1/magazines/${magazineId}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "list-categories") {
                    // list-categoriesツールの実装
                    const data = await noteApiRequest(
                      `/v2/categories`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "list-hashtags") {
                    // list-hashtagsツールの実装
                    const data = await noteApiRequest(
                      `/v2/hashtags`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-stats") {
                    // get-statsツールの実装
                    const { noteId } = args;
                    
                    const data = await noteApiRequest(
                      `/v1/notes/${noteId}/stats`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-membership-summaries") {
                    // get-membership-summariesツールの実装
                    const data = await noteApiRequest(
                      `/v1/memberships/summaries`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-membership-plans") {
                    // get-membership-plansツールの実装
                    const data = await noteApiRequest(
                      `/v1/users/me/membership_plans`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-membership-notes") {
                    // get-membership-notesツールの実装
                    const { size = 10 } = args;
                    
                    const data = await noteApiRequest(
                      `/v1/memberships/notes?size=${size}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-circle-info") {
                    // get-circle-infoツールの実装
                    const { circleId } = args;
                    
                    const data = await noteApiRequest(
                      `/v1/circles/${circleId}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "get-notice-counts") {
                    // get-notice-countsツールの実装
                    const data = await noteApiRequest(
                      `/v3/notice_counts`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "search-all") {
                    // search-allツールの実装
                    const { query, size = 10, sort = "new" } = args;
                    
                    const data = await noteApiRequest(
                      `/v3/searches?context=all&q=${encodeURIComponent(query)}&size=${size}&sort=${sort}`, 
                      "GET", 
                      null, 
                      true
                    );
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2)
                      }]
                    };
                    
                  } else if (name === "analyze-notes") {
                    // analyze-notesツールの実装
                    const { noteIds, analysisType = "all" } = args;
                    
                    // 分析結果のモック（実際のAPIがないため）
                    const analysisResult = {
                      analysisType: analysisType,
                      noteIds: noteIds,
                      engagement: {
                        totalLikes: 0,
                        totalComments: 0,
                        averageLikesPerNote: 0
                      },
                      content: {
                        averageBodyLength: 0,
                        hasImages: false,
                        hasTags: false
                      },
                      price: {
                        paidNotesCount: 0,
                        freeNotesCount: noteIds.length,
                        averagePrice: 0
                      }
                    };
                    
                    result = {
                      content: [{
                        type: "text",
                        text: JSON.stringify(analysisResult, null, 2)
                      }]
                    };
                    
                  } else {
                    // その他のツールは未実装
                    result = {
                      content: [{
                        type: "text",
                        text: `ツール '${name}' はまだHTTPトランスポートで実装されていません。stdioトランスポートで利用してください。`
                      }]
                    };
                  }
                  
                  const response = {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: result
                  };
                  
                  res.end(JSON.stringify(response));
                  console.error(`✅ ツール実行完了: ${name}`);
                  return;
                  
                } catch (error) {
                  console.error(`❌ ツール実行エラー:`, error);
                  const response = {
                    jsonrpc: "2.0",
                    id: message.id,
                    error: {
                      code: -32603,
                      message: "Tool execution error",
                      data: error instanceof Error ? error.message : String(error)
                    }
                  };
                  res.end(JSON.stringify(response));
                  return;
                }
              }
              
              // その他のメソッド
              const response = {
                jsonrpc: "2.0",
                id: message.id,
                error: {
                  code: -32601,
                  message: "Method not found"
                }
              };
              
              res.end(JSON.stringify(response));
              console.error("⚠️ 未対応のメソッド:", message.method);
              
            } catch (error) {
              console.error("❌ JSON-RPC処理エラー:", error);
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32700,
                  message: "Parse error"
                }
              }));
            }
          });
          
          return;
        }
        
        // GETリクエストの場合はSSEストリームを開始
        if (req.method === "GET") {
          try {
            const transport = new SSEServerTransport("/mcp", res);
            await server.connect(transport);
            
            console.error("✅ SSE接続が確立されました");
            
            req.on("close", () => {
              console.error("🔌 SSE接続が閉じられました");
            });
            
          } catch (error) {
            console.error("❌ SSE接続エラー:", error);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "SSE connection failed"
            }));
          }
          
          return;
        }
        
        return;
      }

      // 404エラー
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Not Found",
        message: "利用可能なエンドポイント: /health, /mcp, /sse"
      }));
    });

    // サーバーを起動
    httpServer.listen(PORT, HOST, () => {
      console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
      console.error("🎉 note API MCP Server v2.0.0 (HTTP) が正常に起動しました!");
      console.error(`📡 HTTP/SSE transport で稼働中: http://${HOST}:${PORT}`);
      console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");

      console.error("\n🔗 接続方法:");
      console.error(`  ヘルスチェック: http://${HOST}:${PORT}/health`);
      console.error(`  MCPエンドポイント: http://${HOST}:${PORT}/mcp`);
      console.error(`  SSEエンドポイント: http://${HOST}:${PORT}/sse`);

      console.error("\n📋 利用可能な機能:");
      console.error("🔍 検索機能:");
      console.error("  - search-notes: 記事検索");
      console.error("  - analyze-notes: 記事分析");
      console.error("  - search-users: ユーザー検索");
      console.error("  - search-magazines: マガジン検索");
      console.error("  - search-all: 全体検索");
      
      console.error("\n📝 記事機能:");
      console.error("  - get-note: 記事詳細取得");
      console.error("  - post-draft-note: 下書き投稿");
      console.error("  - get-comments: コメント取得");
      console.error("  - post-comment: コメント投稿");
      console.error("  - like-note / unlike-note: スキ操作");
      console.error("  - get-my-notes: 自分の記事一覧");
      
      console.error("\n👥 ユーザー機能:");
      console.error("  - get-user: ユーザー詳細取得");
      console.error("  - get-user-notes: ユーザーの記事一覧");
      console.error("  - get-stats: PV統計取得");
      
      console.error("\n🎪 メンバーシップ機能:");
      console.error("  - get-membership-summaries: 加入メンバーシップ一覧");
      console.error("  - get-membership-plans: 自分のプラン一覧");
      console.error("  - get-membership-notes: メンバーシップ記事一覧");
      console.error("  - get-circle-info: サークル情報取得");
      
      console.error("\n📚 その他機能:");
      console.error("  - get-magazine: マガジン詳細取得");
      console.error("  - list-categories: カテゴリー一覧");
      console.error("  - list-hashtags: ハッシュタグ一覧");
      console.error("  - get-notice-counts: 通知件数");

      console.error("\n💭 プロンプト:");
      console.error("  - note-search: 記事検索プロンプト");
      console.error("  - competitor-analysis: 競合分析");
      console.error("  - content-idea-generation: アイデア生成");
      console.error("  - article-analysis: 記事分析");
      console.error("  - membership-strategy: メンバーシップ戦略");
      console.error("  - content-calendar: コンテンツカレンダー");

      console.error("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
      console.error("🎯 Ready for HTTP/SSE connections!");
      console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    });

    // エラーハンドリング
    httpServer.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.error(`❌ ポート ${PORT} は既に使用されています`);
        console.error("別のポートを使用するには、環境変数 MCP_HTTP_PORT を設定してください");
      } else {
        console.error("❌ HTTPサーバーエラー:", error);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    console.error("💥 Fatal error during server startup:");
    console.error(error);
    console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
    process.exit(1);
  }
}

// メイン処理の実行
startServer().catch(error => {
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  console.error("💥 Fatal error:");
  console.error(error);
  console.error("◤◢◤◢◤◢◤◢◤◢◤◢◤◢");
  process.exit(1);
});

// ファイル情報の表示（開発用）
if (env.DEBUG) {
  console.error("📂 HTTP Transport 情報:");
  console.error(`🌐 ホスト: ${HOST}`);
  console.error(`🔌 ポート: ${PORT}`);
  console.error("📡 トランスポート: SSE (Server-Sent Events)");
  console.error("🔗 プロトコル: HTTP/1.1");
}
