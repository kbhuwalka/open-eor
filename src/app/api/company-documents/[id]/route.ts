import { AuthError, requireRole } from "@/auth"
import { getDb } from "@/db"
import { readCompanyDocument } from "@/server/master-agreement"

const NO_STORE = { "Cache-Control": "private, no-store" }

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

/**
 * A signed company document (the master EOR agreement). The owning company's client and Northwind
 * onboarding specialists may download it (acl.md §3); the stored bytes are checked against the hash
 * recorded at signing first, and a mismatch is a 409, never a download.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user
  try {
    user = await requireRole("client_hr", "onboarding_specialist")
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "unauthenticated"
        ? problem(401, "unauthenticated", "Sign in to download documents.")
        : problem(403, "forbidden", "Your role cannot download this document.")
    }
    throw error
  }

  const { id } = await params
  const result = await readCompanyDocument(getDb(), user, id)
  if (!result.ok) {
    const status = result.reason === "forbidden" ? 403 : result.reason === "not_found" ? 404 : 409
    return problem(status, result.reason, result.message)
  }

  return new Response(Buffer.from(result.bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "X-Document-SHA256": result.sha256,
    },
  })
}
