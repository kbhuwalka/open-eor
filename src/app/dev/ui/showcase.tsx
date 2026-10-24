"use client"

import { useState } from "react"
import { AlertCircle } from "lucide-react"

import { CompFieldset, useCompValue } from "@/components/forms/comp-fieldset"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Pagination } from "@/components/data-table/pagination"
import { SortableHead } from "@/components/data-table/sortable-head"
import { PersonStatusBadge } from "@/components/person-status"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { US_STATES } from "@/lib/us-states"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const UNITS: Option[] = [
  { value: "hourly", label: "Hourly" },
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annually" },
]
const LOCATIONS: Option[] = US_STATES.map((s) => ({ value: s.code, label: s.name, hint: s.code }))

export function InteractiveShowcase() {
  const [unit, setUnit] = useState("hourly")
  const [stateCode, setStateCode] = useState("CA")
  const [startDate, setStartDate] = useState("")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [comp, setComp] = useCompValue({ wage: "16", wageUnit: "hourly" })
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Block title="Inputs">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-title">Role title</Label>
            <Input id="sc-title" placeholder="Software Engineer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-wage">Hourly wage</Label>
            <Input id="sc-wage" defaultValue="7.24" error />
            <p className="text-xs text-destructive" role="alert">
              Hourly wage $7.24 is below the CA floor of $16.50.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-disabled">Disabled</Label>
            <Input id="sc-disabled" value="Read only" disabled readOnly />
          </div>
        </div>
      </Block>

      <Block title="Select (searchable above 5 options)">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-unit">Unit (2 options)</Label>
            <OptionSelect id="sc-unit" options={UNITS} value={unit} onValueChange={setUnit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-state">Location (51 options)</Label>
            <OptionSelect
              id="sc-state"
              options={LOCATIONS}
              value={stateCode}
              onValueChange={setStateCode}
              placeholder="Choose a location"
            />
            <p className="text-xs text-muted-foreground">
              Selected: <span className="font-mono">{stateCode || "—"}</span>
            </p>
          </div>
        </div>
      </Block>

      <Block title="Date picker">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sc-date">Desired start date</Label>
          <DatePicker
            id="sc-date"
            value={startDate}
            onValueChange={setStartDate}
            placeholder="Select desired start date…"
          />
        </div>
      </Block>

      <div className="md:col-span-2">
        <Block title="Pagination">
          <Pagination
            page={page}
            totalPages={Math.ceil(95 / size)}
            total={95}
            pageSize={size}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setSize(n)
              setPage(1)
            }}
          />
        </Block>
      </div>

      <Block title="Tabs">
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="text-sm text-muted-foreground">
            Snapshot summary goes here.
          </TabsContent>
          <TabsContent value="timeline" className="text-sm text-muted-foreground">
            Case events, newest first.
          </TabsContent>
          <TabsContent value="documents" className="text-sm text-muted-foreground">
            Metadata only for Client HR.
          </TabsContent>
        </Tabs>
      </Block>

      <Block title="Dialog">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>
            Reset agreement to draft
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset agreement?</DialogTitle>
              <DialogDescription>
                Dev-only. Cases in pending EOR setup are unaffected; new hires
                will wait in awaiting agreement until you sign again.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>
                Cancel
              </DialogClose>
              <DialogClose render={<Button variant="danger" />}>
                Reset
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Block>

      <Block title="Alert">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Wage below floor</AlertTitle>
          <AlertDescription>
            The effective hourly wage must be at least $16.50 in CA.
          </AlertDescription>
        </Alert>
      </Block>

      <div className="md:col-span-2">
        <Block title="Compensation fieldset (used by Start a hire)">
          <CompFieldset value={comp} onChange={setComp} stateCode={stateCode} />
        </Block>
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="rounded-lg border border-border bg-card p-4">{children}</div>
    </section>
  )
}

const PEOPLE_SAMPLES = [
  { name: "Jordan Lee", start: "Starts Feb 20" },
  { name: "Taylor Kim", start: "Starts Feb 3" },
]

export function PeopleTableDemo() {
  const [sort, setSort] = useState<"name" | "title" | "status" | "start" | null>("name")
  const head = (key: NonNullable<typeof sort>, label: string, className?: string) => (
    <SortableHead
      label={label}
      active={sort === key}
      direction="asc"
      onSort={() => setSort(sort === key ? null : key)}
      className={className}
    />
  )
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {head("name", "Name")}
            {head("title", "Title")}
            {head("status", "Status")}
            {head("start", "Start", "text-right")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {PEOPLE_SAMPLES.map((sample) => (
            <TableRow key={sample.name}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{sample.name}</span>
                  <span className="text-xs text-muted-foreground">person@worker.example</span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">Software Engineer</TableCell>
              <TableCell>
                <PersonStatusBadge status="onboarding" />
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">{sample.start}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <PersonStatusBadge status="active" />
            </TableCell>
            <TableCell>
              <PersonStatusBadge status="inactive" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-28 rounded-md" />
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
