'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Eye, Search, X } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { businessApi, type BusinessProfile } from '../lib/workspace-api'
import { invoiceHtml, printReceipt, receiptHtml } from './pos/receipt-print'
import type { PosReceipt } from '../lib/pos-api'

type Sale={id:number;receipt_number:string;branch_name:string;cashier_name:string;payment_method:string;payment_reference:string|null;total:string;amount_received:string;change_due:string;created_at:string;status:string}
type Summary={transactions:number;revenue:string;cash:string;mpesa:string;card:string}
type Result={data:Sale[];current_page:number;last_page:number;total:number;summary:Summary}
type Detail={sale:Sale;items:{title:string;sku:string;quantity:number;unit_price:string;line_total:string}[]}
const money=(n:number|string)=>'KSh '+Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
export function SalesHistoryView(){
 const [date,setDate]=useState(today)
 const [search,setSearch]=useState('')
 const [term,setTerm]=useState('')
 const [method,setMethod]=useState('')
 const [page,setPage]=useState(1)
 const [result,setResult]=useState<Result|null>(null)
 const [detail,setDetail]=useState<Detail|null>(null)
 const [profile,setProfile]=useState<BusinessProfile|null>(null)
 const [customerName,setCustomerName]=useState('Walk-in customer')
 const [customerEmail,setCustomerEmail]=useState('')
 const [customerAddress,setCustomerAddress]=useState('')
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const load=useCallback(async()=>{setLoading(true);setError('');try{setResult(await api<Result>('/pos/sales',{query:{date,search:term,payment_method:method,page}}))}catch(e){setError(errorMessage(e))}finally{setLoading(false)}},[date,term,method,page])
 useEffect(()=>{void load()},[load])
 useEffect(()=>{void businessApi.get().then(setProfile).catch(()=>{})},[])
 async function view(id:number){try{setDetail(await api<Detail>(`/pos/sales/${id}`));setCustomerName('Walk-in customer');setCustomerEmail('');setCustomerAddress('')}catch(e){setError(errorMessage(e))}}
 function asReceipt():PosReceipt|null {return detail ? {sale:detail.sale as PosReceipt['sale'],items:detail.items}:null}
 function printDocument(type:'receipt'|'invoice'){const data=asReceipt();if(!data)return;printReceipt(type==='receipt'?receiptHtml(data,profile,{shopName:profile?.name||'Hekima Bookshop',branch:detail?.sale.branch_name,cashier:detail?.sale.cashier_name}):invoiceHtml(data,profile,{name:customerName,email:customerEmail,address:customerAddress}))}
 function emailInvoice(){if(!detail||!customerEmail.trim())return;const subject=encodeURIComponent('Invoice INV-'+detail.sale.receipt_number);const body=encodeURIComponent('Hello '+customerName+',\\n\\nPlease find your paid invoice INV-'+detail.sale.receipt_number+' for '+money(detail.sale.total)+'.\\n\\nKindly contact us if you need a PDF copy.');window.location.href='mailto:'+encodeURIComponent(customerEmail.trim())+'?subject='+subject+'&body='+body}
 function exportCsv(){if(!result)return;const rows=[['Receipt','Date','Branch','Cashier','Method','Reference','Total','Status'],...result.data.map(s=>[s.receipt_number,s.created_at,s.branch_name,s.cashier_name,s.payment_method,s.payment_reference||'',s.total,s.status])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`hekima-sales-${date||'all'}-page-${page}.csv`;a.click();URL.revokeObjectURL(url)}
 const summary=result?.summary
 return <div className="products-page">
  <div className="page-heading compact"><div><div className="eyebrow">PHASE 03 · SALES OPERATIONS</div><h1 tabIndex={-1}>Sales History</h1><p>Review completed transactions, print receipts and prepare paid invoices.</p></div><div className="heading-actions"><button className="secondary-button" disabled={!result?.data.length} onClick={exportCsv}><Download size={16}/> Export current page</button></div></div>
  <div className="catalog-stats">{[{label:'Sales total',value:money(summary?.revenue||0),hint:'For selected filters'},{label:'Transactions',value:String(summary?.transactions||0),hint:'Completed sales'},{label:'Cash',value:money(summary?.cash||0),hint:'Cash sales'},{label:'M-Pesa',value:money(summary?.mpesa||0),hint:'Manually recorded payments'}].map(x=><div className="card catalog-stat" key={x.label}><span>{x.label}</span><strong>{x.value}</strong><small>{x.hint}</small></div>)}</div>
  <section className="card inventory-table-card"><div className="card-heading"><div><h2>Transaction register</h2><p>{date?'Sales on '+date:'All recorded dates'} · {result?.total??0} matching transactions</p></div></div>
  <div className="flex flex-wrap items-end gap-3 px-4 pb-4">
   <label className="text-sm font-medium">Sales date<input className="text-input mt-1 block" type="date" value={date} onChange={e=>{setDate(e.target.value);setPage(1)}}/></label>
   <button className="secondary-button" onClick={()=>{setDate(today());setPage(1)}}>Today</button>
   <button className="secondary-button" onClick={()=>{setDate('');setPage(1)}}>All dates</button>
   <label className="text-sm font-medium">Payment<select className="text-input mt-1 block" value={method} onChange={e=>{setMethod(e.target.value);setPage(1)}}><option value="">All methods</option><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option></select></label>
   <form className="inventory-search" onSubmit={e=>{e.preventDefault();setTerm(search);setPage(1)}}><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Receipt or payment reference…"/><button type="submit" className="text-sm font-semibold">Search</button></form>
  </div>
  {error&&<p role="alert" className="mx-4 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button onClick={()=>void load()} className="underline">Retry</button></p>}
  <div className="table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Date & time</th><th>Branch / cashier</th><th>Payment</th><th>Total</th><th>Status</th><th>Details</th></tr></thead><tbody>
   {result?.data.map(s=><tr key={s.id}><td><strong>{s.receipt_number}</strong></td><td>{new Date(s.created_at).toLocaleString('en-KE')}</td><td><strong>{s.branch_name||'—'}</strong><small>{s.cashier_name||'—'}</small></td><td>{s.payment_method==='mpesa'?'M-Pesa':s.payment_method}<small>{s.payment_reference||''}</small></td><td><strong>{money(s.total)}</strong></td><td><span className="status-chip">{s.status}</span></td><td><button className="icon-button" title="View receipt" aria-label={'View '+s.receipt_number} onClick={()=>void view(s.id)}><Eye size={18}/></button></td></tr>)}
   {!loading&&!result?.data.length&&<tr><td colSpan={7} className="p-8 text-center">No sales match the selected filters.</td></tr>}
   {loading&&<tr><td colSpan={7} className="p-8 text-center">Loading sales…</td></tr>}
  </tbody></table></div>
  <div className="flex items-center justify-between gap-3 p-4 text-sm"><span>Page {result?.current_page||1} of {result?.last_page||1}</span><div className="flex gap-2"><button className="secondary-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><button className="secondary-button" disabled={page>=(result?.last_page||1)} onClick={()=>setPage(p=>p+1)}>Next</button></div></div></section>
  {detail&&<div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Sale receipt"><div className="modal-header"><div><div className="eyebrow">SALE RECEIPT</div><h2>{detail.sale.receipt_number}</h2></div><button className="icon-button" onClick={()=>setDetail(null)}><X size={18}/></button></div><p className="py-3 text-sm">{new Date(detail.sale.created_at).toLocaleString('en-KE')} · {detail.sale.payment_method}</p><div className="max-h-64 overflow-auto">{detail.items.map((i,index)=><div className="flex justify-between gap-3 border-b py-2 text-sm" key={index}><span>{i.title} × {i.quantity}</span><strong>{money(i.line_total)}</strong></div>)}</div><div className="checkout-total"><span>Total paid</span><strong>{money(detail.sale.total)}</strong></div><p className="py-2 text-xs">Received: {money(detail.sale.amount_received)} · Change: {money(detail.sale.change_due)}</p><div className="mt-4 grid gap-2 border-t pt-4"><h3 className="text-sm font-bold">Invoice billing details</h3><input className="text-input" aria-label="Customer name" placeholder="Customer name" value={customerName} onChange={e=>setCustomerName(e.target.value)}/><input className="text-input" aria-label="Customer email" type="email" placeholder="Customer email (optional)" value={customerEmail} onChange={e=>setCustomerEmail(e.target.value)}/><input className="text-input" aria-label="Billing address" placeholder="Billing address (optional)" value={customerAddress} onChange={e=>setCustomerAddress(e.target.value)}/><div className="flex flex-wrap gap-2"><button className="secondary-button" onClick={()=>printDocument('receipt')}>Print receipt</button><button className="primary-button" onClick={()=>printDocument('invoice')}>Print / Save invoice as PDF</button><button className="secondary-button" disabled={!customerEmail.trim()} onClick={emailInvoice}>Prepare invoice email</button></div><p className="text-xs text-slate-500">Print / Save opens the browser print dialog; select Save as PDF to download. Email opens your mail app and does not attach the PDF automatically. Billing fields are not yet saved.</p></div></div></div>}
 </div>
}
