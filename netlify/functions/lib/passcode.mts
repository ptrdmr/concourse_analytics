const WRONG_CODE_DELAY_MS = 500;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** Null when the request may proceed. A wrong code waits briefly so guessing is not free. */
export async function passcodeError(req: Request): Promise<Response | null> {
  const expected = Netlify.env.get("TIP_WORKSHEET_PASSCODE") || "";
  if (!expected) {
    return json(503, { error: "TIP_WORKSHEET_PASSCODE is not set on the site" });
  }
  const got = req.headers.get("x-tip-passcode") || "";
  if (!timingSafeEqual(got, expected)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_CODE_DELAY_MS));
    return json(401, { error: "Wrong passcode" });
  }
  return null;
}
