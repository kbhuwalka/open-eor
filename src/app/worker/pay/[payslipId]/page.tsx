import { Suspense } from "react"
import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import { WORKER_PAY_HREFS } from "@/components/pay/hrefs"
import { PayslipDetailSkeleton } from "@/components/pay/pay-skeletons"
import { PayslipDetailView } from "@/components/pay/payslip-detail-view"
import payData from "@/server/pay-queries"

type Params = Promise<{ payslipId: string }>

/** Page params keep their percent-encoding (pay slip ids contain colons), unlike route handler params. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export default function PayslipPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<PayslipDetailSkeleton />}>
      <Payslip params={params} />
    </Suspense>
  )
}

async function Payslip({ params }: { params: Params }) {
  const [user, { payslipId }] = await Promise.all([requirePortalUser("worker"), params])
  const detail = await payData.getPayslipDetail(user.id, decodeSegment(payslipId), { now: new Date() })
  if (!detail) notFound()
  return <PayslipDetailView detail={detail} hrefs={WORKER_PAY_HREFS} />
}
