import { useState } from 'react'
import { ReceiptText } from 'lucide-react'
import { PageHeader } from '../../components/ui-kit'
import { BillDetailModal, PaymentsTable, useBills } from './payments-reconciliation'

/**
 * Bills: every payment Safaricom has reported for platform subscriptions, read straight from saf_payments.
 * The eye icon opens everything known about a payment. Reconciliation work lives on /platform/billing.
 */
export default function BillsView() {
  const { bills, filters, setFilters, search, setSearch } = useBills()
  const [selected, setSelected] = useState<number | null>(null)

  return <div className="grid gap-6">
    <PageHeader eyebrow="M-Pesa · Safaricom" icon={<ReceiptText size={22} />} title="Bills"
      description={`All M-Pesa payments received from Safaricom${bills.data ? ` · ${bills.data.total} payment(s)` : ''}. Select the eye icon to see the full payment details.`} />
    <PaymentsTable bills={bills} filters={filters} setFilters={setFilters} search={search} setSearch={setSearch} onView={setSelected} />
    {selected !== null && <BillDetailModal id={selected} canManage={false} onClose={() => setSelected(null)} />}
  </div>
}
