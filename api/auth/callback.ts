import { json } from "../_lib/server";

export async function GET() {
  return json({ ok: true });
}
