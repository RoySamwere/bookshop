import { useState } from 'react'
import { PlatformTitle } from './platform-ui'
import { BillDetailModal, PaymentsTable, useBills } from './payments-reconciliation'

/**
 * Bills: every payment Safaricom has reported for platform subscriptions, read straight from saf_payments.
 * The eye icon opens everything known about a payment. The /platform/bills address now opens Billing > Payments,
 * which includes this same table with reconciliation tools; this read-only view is kept for reuse.
 */
export default function BillsView() {
  const { bills, filters, setFilters, search, setSearch } = useBills()
  const [selected, setSelected] = useState<number | null>(null)

  return <div className="grid gap-6">
    <PlatformTitle title="Bills"
      description={`All M-Pesa payments received from Safaricom${bills.data ? `, ${bills.data.total} in total` : ''}. Select the eye icon to see the full payment details.`} />
    <PaymentsTable bills={bills} filters={filters} setFilters={setFilters} search={search} setSearch={setSearch} onView={setSelected} />
    {selected !== null && <BillDetailModal id={selected} canManage={false} onClose={() => setSelected(null)} />}
  </div>
}
