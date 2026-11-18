import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@netlify/functions";
import { json, passcodeError } from "./lib/passcode.mts";

const MONTH = /^\d{4}-\d{2}$/;
const FILES = {
  gratuity: "gratuity.json",
  service_charges: "service_charges.json",
} as const;

function dataPath(...parts: string[]): string {
  return join(process.cwd(), "public", "data", ...parts);
}

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
  let target = "";
  if (month) {
    if (!MONTH.test(month)) return json(400, { error: "month must be YYYY-MM" });
    target = dataPath("tips", `${month}.json`);
  } else if (file === "gratuity" || file === "service_charges") {
    target = dataPath(FILES[file]);
  } else {
    return json(400, { error: "month, file, or check is required" });
  }

  try {
    return fileResponse(await readFile(target, "utf8"));
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return json(404, { error: "Not found" });
    return json(500, { error: "Could not read tip data" });
  }
}
