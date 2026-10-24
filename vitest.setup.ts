import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import "@testing-library/jest-dom/vitest"

// Every test database is seeded, and the seed stores sample identity documents: keep them out of the
// repo's data/uploads. Tests that need their own root set `UPLOADS_ROOT` themselves.
if (!process.env.UPLOADS_ROOT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eor-test-uploads-"))
  process.env.UPLOADS_ROOT = root
  process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }))
}
