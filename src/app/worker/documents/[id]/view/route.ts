import { employeeDocumentResponse } from "@/server/employee-document-response"

/** The same signed copy and the same checks as the download, shown inline so it opens in a browser tab (acl F5). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return employeeDocumentResponse(id, "inline")
}
