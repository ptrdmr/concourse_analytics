import { getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { json, passcodeError } from "./lib/passcode.mts";

const MONTH = /^\d{4}-\d{2}$/;

function fileResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== "GET") return json(405, { error: "method not allowed" });
  const denied = await passcodeError(req);
  if (denied) return denied;

  const url = new URL(req.url);
  if (url.searchParams.get("check") === "1") return json(200, { ok: true });

  const month = url.searchParams.get("month") || "";
  const file = url.searchParams.get("file") || "";
  let key = "";
  if (month) {
    if (!MONTH.test(month)) return json(400, { error: "month must be YYYY-MM" });
    key = `tips/${month}.json`;
  } else if (file === "gratuity" || file === "service_charges") {
    key = `${file}.json`;
  } else {
    return json(400, { error: "month, file, or check is required" });
  }

  try {
    const text = await getDeployStore().get(key, { type: "text", consistency: "strong" });
    if (text == null) return json(404, { error: "Not found" });
    return fileResponse(text);
  } catch {
    return json(500, { error: "Could not read tip data" });
  }
}
