import { clearPersona } from "@/auth/actions"
import { Button } from "@/components/ui/button"

/** Chrome control: return to `/pick` after clearing the session cookie. */
export function PersonaSwitcher() {
  return (
    <form action={clearPersona}>
      <Button type="submit" variant="outline" size="sm">
        Switch persona
      </Button>
    </form>
  )
}
