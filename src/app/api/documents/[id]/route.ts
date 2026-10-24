import { AuthError, requireRole } from "@/auth"
import { getDb } from "@/db"
import { readIdentityUpload } from "@/server/employee-documents"

const NO_STORE = { "Cache-Control": "private, no-store" }

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

/**
 * An identity document an employee uploaded, shown inline (thumbnails and the viewer). Only the
 * employee it belongs to and Northwind onboarding specialists may read it; a client company never
 * can (acl F5). Another person's document is a 404, the same as a missing one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user
  try {
    user = await requireRole("worker", "onboarding_specialist")
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "unauthenticated"
        ? problem(401, "unauthenticated", "Sign in to view documents.")
        : problem(403, "forbidden", "Your role cannot view this document.")
    }
    throw error
  }

  const { id } = await params
  const result = readIdentityUpload(getDb(), user, id)
  if (!result.ok) return problem(result.reason === "forbidden" ? 403 : 404, result.reason, result.message)

  return new Response(Buffer.from(result.bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": result.mime,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
