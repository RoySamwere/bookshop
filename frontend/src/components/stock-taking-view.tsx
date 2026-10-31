'use client'

import { useEffect, useState } from 'react'
import { ClipboardCheck, Download, RefreshCw, Upload } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import type { BookshopUser } from '../lib/auth'

type StockLine = {book_id:number;branch_id:number;sku:string;title:string;branch_name:string;quantity:number;reserved:number}
type CountLine = StockLine & {expected_quantity:number;counted_quantity:number}
type Snapshot = {rows:StockLine[];generated_at:string}
const headings=['Book ID','Branch ID','SKU','Product','Branch','System Quantity','Reserved','Physical Count']
const numeric=(v:unknown)=>Number(v??0)
export function StockTakingView({currentUser,notify}:{currentUser:BookshopUser;notify:(message:string)=>void}) {
  const canManage=currentUser.permissions.includes('inventory.manage')
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [rows,setRows]=useState<CountLine[]>([])
  const [reason,setReason]=useState('Physical stock count reconciliation')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [filter,setFilter]=useState('')
  async function load(){
    setBusy(true);setError('')
    try{const data=await api<Snapshot>('/inventory/stocktake-snapshot');setSnapshot(data);setRows(data.rows.map(r=>({...r,expected_quantity:Number(r.quantity),counted_quantity:Number(r.quantity),reserved:Number(r.reserved)})))}
    catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }
  useEffect(()=>{void load()},[])
  async function download(){
    if(!snapshot)return
    setBusy(true);setError('')
    try{
      const ExcelJS=(await import('exceljs')).default
      const workbook=new ExcelJS.Workbook()
      const sheet=workbook.addWorksheet('Stock Count')
      sheet.addRow(headings)
      sheet.columns=[{width:13},{width:13},{width:23},{width:46},{width:25},{width:20},{width:14},{width:20}]
      for(const item of snapshot.rows){const row=sheet.addRow([item.book_id,item.branch_id,item.sku,item.title,item.branch_name,Number(item.quantity),Number(item.reserved),null]);row.getCell(8).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};row.getCell(8).numFmt='0'}
      sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}
      sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F766E'}}
      sheet.views=[{state:'frozen',ySplit:1}]
      sheet.autoFilter={from:'A1',to:'H1'}
      const guide=workbook.addWorksheet('Instructions')
      guide.addRow(['HEKIMA STOCK TAKING — OFFLINE COUNT'])
      guide.addRow(['Generated at',snapshot.generated_at])
      guide.addRow(['Enter whole-number physical counts in the yellow Physical Count column (H).'])
      guide.addRow(['Leave H blank for items not counted; blank items will not be updated.'])
      guide.addRow(['Do not edit Book ID, Branch ID or System Quantity.'])
      guide.addRow(['Upload this .xlsx file when online. Review differences before applying.'])
      guide.addRow(['If sales or receipts changed system quantities after export, reconciliation will stop and require a new snapshot.'])
      guide.getColumn(1).width=105;guide.getColumn(2).width=36
      const buffer=await workbook.xlsx.writeBuffer()
      const blob=new Blob([buffer as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='hekima-stocktake-'+new Date().toISOString().slice(0,10)+'.xlsx';a.click();URL.revokeObjectURL(url)
    }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }
  async function upload(file:File){
    setBusy(true);setError('')
    try{
      const ExcelJS=(await import('exceljs')).default
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer())
      const sheet=workbook.getWorksheet('Stock Count')
      if(!sheet)throw Error('Select a Hekima stocktake workbook with a Stock Count sheet.')
      if(headings.some((h,i)=>String(sheet.getRow(1).getCell(i+1).value??'').trim()!==h))throw Error('Stocktake columns were changed. Download a fresh template.')
      const imported:CountLine[]=[];const seen=new Set<string>()
      for(let n=2;n<=sheet.rowCount;n++){
        const row=sheet.getRow(n);const raw=row.getCell(8).value
        if(raw===null||raw===undefined||String(raw).trim()==='')continue
        const id=numeric(row.getCell(1).value),branchId=numeric(row.getCell(2).value)
        const count=Number(raw),expected=Number(row.getCell(6).value)
        if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(expected)||expected<0)throw Error('Invalid physical count or original quantity at Excel row '+n)
        const key=id+':'+branchId
        if(seen.has(key))throw Error('Duplicate product and branch at Excel row '+n)
        seen.add(key)
        imported.push({book_id:id,branch_id:branchId,sku:String(row.getCell(3).value??''),title:String(row.getCell(4).value??''),branch_name:String(row.getCell(5).value??''),quantity:expected,reserved:Number(row.getCell(7).value??0),expected_quantity:expected,counted_quantity:count})
      }
      if(!imported.length)throw Error('No physical counts found. Fill in the yellow Physical Count column.')
      setRows(imported);notify(imported.length+' counted products imported for review.')
    }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }
  const changed=rows.filter(r=>r.counted_quantity!==r.expected_quantity)
  const visible=rows.filter(r=>(r.title+' '+r.sku+' '+r.branch_name).toLowerCase().includes(filter.toLowerCase()))
  async function apply(){
    if(!canManage||!changed.length)return
    if(!reason.trim()||reason.trim().length<5){setError('Provide a reason of at least five characters.');return}
    if(changed.length>500){setError('More than 500 adjustments. Process a smaller stocktake file first.');return}
    setBusy(true);setError('')
    try{
      const result=await api<{adjusted:number}>('/inventory/stocktake-apply',{method:'POST',body:{reason:reason.trim(),rows:changed.map(r=>({book_id:r.book_id,branch_id:r.branch_id,expected_quantity:r.expected_quantity,counted_quantity:r.counted_quantity}))}})
      notify(result.adjusted+' inventory balances reconciled.');await load()
    }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }
  return <main className="mx-auto w-full max-w-[1500px] space-y-5 px-3 pb-10 sm:px-5">
    <div><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Inventory control</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Stock Taking</h1><p className="text-sm text-slate-500">Count physical stock online or download an Excel sheet to count offline and upload later.</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" className="primary-button" disabled={busy||!snapshot} onClick={()=>void download()}><Download size={16}/> Download Excel for offline count</button><label className={`secondary-button cursor-pointer ${busy?'opacity-50':''}`}><Upload size={16}/> Upload completed Excel<input type="file" className="sr-only" accept=".xlsx" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value=''}}/></label><button type="button" className="secondary-button" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/> Refresh live stock</button></div>
    <p className="text-xs text-slate-500">Offline: download the file, enter physical quantities in the yellow column, save it, and upload when connected. Empty physical counts are skipped. Only differences are submitted.</p>
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-3">{[['Products counted',rows.length],['Differences',changed.length],['Net unit difference',changed.reduce((sum,r)=>sum+r.counted_quantity-r.expected_quantity,0)]].map(([label,value])=><div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-slate-900">{value}</p></div>)}</div>
    <div className="rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><h2 className="font-semibold">Physical count review</h2><input className="text-input max-w-xs" placeholder="Search products or branches" value={filter} onChange={e=>setFilter(e.target.value)}/></div><div className="max-h-[60vh] overflow-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Product','Branch','System','Reserved','Physical count','Difference'].map(h=><th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody className="divide-y">{visible.map(r=><tr key={r.book_id+':'+r.branch_id}><td className="px-3 py-3"><strong>{r.title}</strong><p className="text-xs text-slate-500">{r.sku}</p></td><td className="px-3 py-3">{r.branch_name}</td><td className="px-3 py-3">{r.expected_quantity}</td><td className="px-3 py-3">{r.reserved}</td><td className="px-3 py-3"><input aria-label={'Physical count for '+r.title} className="text-input w-28" type="number" min="0" step="1" disabled={!canManage||busy} value={r.counted_quantity} onChange={e=>{const v=Number(e.target.value);if(!Number.isSafeInteger(v)||v<0)return;setRows(old=>old.map(item=>item.book_id===r.book_id&&item.branch_id===r.branch_id?{...item,counted_quantity:v}:item))}}/></td><td className={`px-3 py-3 font-semibold ${r.counted_quantity-r.expected_quantity<0?'text-rose-700':r.counted_quantity-r.expected_quantity>0?'text-teal-700':''}`}>{r.counted_quantity-r.expected_quantity>0?'+':''}{r.counted_quantity-r.expected_quantity}</td></tr>)}</tbody></table></div>{!rows.length&&<p className="p-6 text-sm text-slate-500">No assigned stock to count yet.</p>}</div>
    {canManage&&<div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"><label className="flex-1 text-sm font-semibold">Reason for stocktake adjustment<input className="text-input mt-2 w-full" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" className="primary-button" disabled={busy||!changed.length} onClick={()=>void apply()}><ClipboardCheck size={16}/> Apply {changed.length} adjustment(s)</button></div>}
    <p className="text-xs text-slate-500">Safety: the server checks original quantities again before updating. Changed balances, inaccessible branches, and reductions below reserved stock are rejected. Adjustments are recorded in inventory history.</p>
  </main>
}
