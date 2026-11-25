import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Context } from "@netlify/functions";
import { json, passcodeError } from "./lib/passcode.mts";

const MONTH = /^\d{4}-\d{2}$/;

// scripts/pack_tip_data.mjs writes these at build time; netlify.toml bundles them
// into this function only. The bundle keeps repo-relative paths, so the folder is
// found from the working directory or from this file's own location.
const CANDIDATES = [
  join(process.cwd(), "netlify", "tip-data"),
  fileURLToPath(new URL("../tip-data/", import.meta.url)),
];

let dataDir: Promise<string | null> | null = null;

function findDataDir(): Promise<string | null> {
  dataDir ??= (async () => {
    for (const dir of CANDIDATES) {
      try {
        await access(join(dir, "gratuity.json.gz"));
        return dir;
      } catch {
        // Try the next location.
      }
    }
    return null;
  })();
  return dataDir;
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
  let rel = "";
  if (month) {
    if (!MONTH.test(month)) return json(400, { error: "month must be YYYY-MM" });
    rel = join("tips", `${month}.json.gz`);
  } else if (file === "gratuity" || file === "service_charges") {
    rel = `${file}.json.gz`;
  } else {
    return json(400, { error: "month, file, or check is required" });
  }

  const dir = await findDataDir();
  if (!dir) return json(500, { error: "Tip data was not bundled with this deploy" });

  try {
    return fileResponse(gunzipSync(await readFile(join(dir, rel))).toString("utf8"));
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return json(404, { error: "Not found" });
    return json(500, { error: "Could not read tip data" });
  }
}
