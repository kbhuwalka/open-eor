import { employeeDocumentResponse } from "@/server/employee-document-response"

/** The signed copy of one of the employee's documents as a file download (acl F5). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return employeeDocumentResponse(id, "attachment")
}
