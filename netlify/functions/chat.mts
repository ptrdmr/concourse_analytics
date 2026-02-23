import type { Context } from "@netlify/functions";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are an analytics assistant for Concourse Bowl-Bar-Grill, a bowling center with food, bar, bowling, arcade, parties, and league departments.

You have access to tools that can search and analyze the full POS transaction database (125K+ rows, Jan 2023 - present). USE TOOLS whenever the user asks about:
- Specific items, products, or menu items
- Time comparisons (this month vs last month, year over year)
- Rankings (top sellers, worst performers, most popular)
- Category breakdowns or department analysis
- Trends or historical data for any item

Only answer from the page summary context (without tools) for very general questions like "what's the total revenue?"

Be concise (2-4 sentences unless asked for detail). Format numbers as currency or with commas. When comparing periods, always calculate the percentage change. Do not make up data -- if you need specifics, use a tool.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_items",
      description: "Search for items/products by name, department, category, and/or date range. Use this when the user asks about specific menu items or products.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term to match against item names (partial match). Leave empty to match all items." },
          department: { type: "string", description: "Filter by department: Food, Bar, Bowling, League Fees, Parties, Arcade, General Income, Vending Machines" },
          category: { type: "string", description: "Filter by category/subcategory" },
          start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
          limit: { type: "number", description: "Max results to return (default 20, max 50)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item_history",
      description: "Get monthly revenue and quantity history for a specific item. Use this for trend questions like 'how has X performed over time?'",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "Item name to look up (partial match)" },
          department: { type: "string", description: "Optional department filter" },
        },
        required: ["item_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_periods",
      description: "Compare metrics between two date ranges. Use this for questions like 'how does January compare to December?' or 'year over year comparison'.",
      parameters: {
        type: "object",
        properties: {
          period1_start: { type: "string", description: "Period 1 start date (YYYY-MM-DD)" },
          period1_end: { type: "string", description: "Period 1 end date (YYYY-MM-DD)" },
          period2_start: { type: "string", description: "Period 2 start date (YYYY-MM-DD)" },
          period2_end: { type: "string", description: "Period 2 end date (YYYY-MM-DD)" },
          department: { type: "string", description: "Optional department filter" },
          item_name: { type: "string", description: "Optional item name filter (partial match)" },
        },
        required: ["period1_start", "period1_end", "period2_start", "period2_end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_category_breakdown",
      description: "Get revenue breakdown by category for a department. Use this for questions about category mix or what drives revenue.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "Department to analyze (e.g. Food, Bar, Bowling)" },
          start_date: { type: "string", description: "Optional start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "Optional end date (YYYY-MM-DD)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_items",
      description: "Get top N items ranked by revenue or quantity. Use this for 'best sellers', 'top performers', or ranking questions.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "Optional department filter" },
          start_date: { type: "string", description: "Optional start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "Optional end date (YYYY-MM-DD)" },
          sort_by: { type: "string", description: "Sort by 'revenue' (default) or 'quantity'" },
          limit: { type: "number", description: "Number of items to return (default 10, max 50)" },
        },
        required: [],
      },
    },
  },
];

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface RequestBody {
  messages: ChatMessage[];
  dataContext: string;
}

export default async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Netlify.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "DEEPSEEK_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, dataContext } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const systemMessage: ChatMessage = {
    role: "system",
    content: `${SYSTEM_PROMPT}\n\n--- CURRENT DASHBOARD DATA ---\n${dataContext || "No data context provided."}`,
  };

  const deepseekMessages = [systemMessage, ...messages.slice(-20)];

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: deepseekMessages,
      tools: TOOLS,
      stream: false,
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(
      JSON.stringify({ error: `DeepSeek API error: ${response.status}`, detail: errorText }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await response.json();
  const choice = result.choices?.[0];
  const message = choice?.message;

  if (message?.tool_calls && message.tool_calls.length > 0) {
    return new Response(
      JSON.stringify({
        type: "tool_calls",
        calls: message.tool_calls,
        message,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  return new Response(
    JSON.stringify({
      type: "content",
      content: message?.content || "",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
