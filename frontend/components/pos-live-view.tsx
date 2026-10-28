'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, Minus, Plus, Search, ShoppingBag, ShoppingCart, Trash2, Wallet, X, ScanBarcode, ReceiptText } from 'lucide-react'
import { api, errorMessage } from '../lib/api'

type Product={id:number;title:string;sku:string;isbn:string|null;selling_price:string|number;available:number;category:string|null;subcategory:string|null}
type Branch={id:number;name:string}
type Item={product:Product;quantity:number}
type Receipt={sale:{id:number;receipt_number:string;total:string;payment_method:string;amount_received:string;change_due:string;created_at:string};items:{title:string;sku:string;quantity:number;unit_price:string;line_total:string}[]}
const money=(v:number)=>'KSh '+v.toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})
export function PosLiveView({notify,userId}:{notify:(message:string)=>void;userId:number}){
 const [branches,setBranches]=useState<Branch[]>([])
 const [branch,setBranch]=useState('')
 const [query,setQuery]=useState('')
 const [category,setCategory]=useState('')
 const [products,setProducts]=useState<Product[]>([])
 const [cart,setCart]=useState<Item[]>([])
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [checkout,setCheckout]=useState(false)
 const [payment,setPayment]=useState<'cash'|'mpesa'|'card'>('cash')
 const [reference,setReference]=useState('')
 const [received,setReceived]=useState('')
 const [busy,setBusy]=useState(false)
 const [key,setKey]=useState('')
 const [receipt,setReceipt]=useState<Receipt|null>(null)
 const [refresh,setRefresh]=useState(0)
 const [cartVisible,setCartVisible]=useState(false)
 const [restored,setRestored]=useState(false)
 const [completed,setCompleted]=useState(false)
 const storageKey=`hekima_pos_draft_v1_${userId}`
 useEffect(()=>{
   try {
     const raw=localStorage.getItem(storageKey)
     if(raw){
       const draft=JSON.parse(raw) as {branch?:string;cart?:Item[];query?:string;category?:string;checkout?:boolean;payment?:'cash'|'mpesa'|'card';reference?:string;received?:string;key?:string}
       if(typeof draft.branch==='string')setBranch(draft.branch)
       if(Array.isArray(draft.cart))setCart(draft.cart.filter(i=>i?.product?.id&&Number.isInteger(i.quantity)&&i.quantity>0))
       if(typeof draft.query==='string')setQuery(draft.query)
       if(typeof draft.category==='string')setCategory(draft.category)
       if(draft.payment==='cash'||draft.payment==='mpesa'||draft.payment==='card')setPayment(draft.payment)
       if(typeof draft.reference==='string')setReference(draft.reference)
       if(typeof draft.received==='string')setReceived(draft.received)
       if(typeof draft.key==='string')setKey(draft.key)
       if(draft.checkout===true&&draft.cart?.length)setCheckout(true)
     }
   }catch{ /* A malformed draft must not prevent opening POS. */ }
   setRestored(true)
   api<Branch[]>('/pos/branches').then(rows=>{setBranches(rows);setBranch(old=>rows.some(b=>String(b.id)===old)?old:String(rows[0]?.id??''))}).catch(e=>setError(errorMessage(e)))
 },[storageKey])
 useEffect(()=>{
   if(!restored||completed)return
   try{localStorage.setItem(storageKey,JSON.stringify({branch,cart,query,category,checkout,payment,reference,received,key}))}catch{ /* Browser storage may be unavailable. */ }
 },[storageKey,restored,branch,cart,query,category,checkout,payment,reference,received,key])
 useEffect(()=>{if(!branch)return;let cancelled=false;setLoading(true);setError('');api<{data:Product[]}>('/pos/products',{query:{branch_id:branch,search:query}}).then(r=>{if(!cancelled)setProducts(r.data)}).catch(e=>{if(!cancelled)setError(errorMessage(e))}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[branch,query,refresh])

 const categories=useMemo(()=>Array.from(new Set(products.map(p=>p.category).filter((x):x is string=>!!x))),[products])
 const filtered=useMemo(()=>products.filter(p=>!category||p.category===category),[products,category])
 const itemCount=cart.reduce((sum,i)=>sum+i.quantity,0)
 const lowStock=filtered.filter(p=>Number(p.available)>0&&Number(p.available)<=5).length
 const subtotal=cart.reduce((sum,i)=>sum+Number(i.product.selling_price)*i.quantity,0)
 function add(product:Product){setCompleted(false);setCart(items=>{let existing=items.find(i=>i.product.id===product.id);if(existing)return items.map(i=>i.product.id===product.id?{...i,quantity:Math.min(Number(product.available),i.quantity+1)}:i);return [...items,{product,quantity:1}]})}
 function quantity(id:number,delta:number){setCart(items=>items.flatMap(i=>i.product.id===id?(i.quantity+delta>0?[{...i,quantity:Math.min(Number(i.product.available),i.quantity+delta)}]:[]):[i]))}
 function openCheckout(){setReference('');setPayment('cash');setReceived(subtotal.toFixed(2));setKey(crypto.randomUUID());setCheckout(true)}
 async function complete(){
   if(busy||!branch||!cart.length)return
   setBusy(true);setError('')
   try{
     const r=await api<Receipt>('/pos/checkout',{method:'POST',body:{idempotency_key:key,branch_id:Number(branch),items:cart.map(i=>({book_id:i.product.id,quantity:i.quantity})),payment_method:payment,payment_reference:reference||null,amount_received:Number(received)}})
     try{localStorage.removeItem(storageKey)}catch{};setCompleted(true);setReceipt(r);setCheckout(false);setCart([]);setKey('');setRefresh(x=>x+1);notify('Sale completed · '+r.sale.receipt_number)
   }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 function printReceipt(){if(!receipt)return;const html=`<!doctype html><html><head><title>Receipt</title><style>body{font:13px monospace;width:280px;margin:20px auto}table{width:100%}td:last-child{text-align:right}@media print{body{margin:0}}</style></head><body><h2>HEKIMA BOOKSHOP</h2><p>${receipt.sale.receipt_number}<br>${receipt.sale.created_at}</p><hr><table>${receipt.items.map(i=>`<tr><td>${i.title.replaceAll('<','&lt;')} × ${i.quantity}</td><td>${i.line_total}</td></tr>`).join('')}</table><hr><h3>Total: KSh ${receipt.sale.total}</h3><p>Payment: ${receipt.sale.payment_method}<br>Received: ${receipt.sale.amount_received}<br>Change: ${receipt.sale.change_due}</p><p>Thank you for shopping with us.</p></body></html>`;const w=window.open('','_blank','width=380,height=650');if(w){w.document.write(html);w.document.close();w.focus();w.print()}}
 return <div className="min-h-[calc(100vh-64px)] bg-[#f5f7fb] px-3 pb-24 pt-4 text-slate-900 sm:px-6 lg:px-8 lg:pb-8">
   <div className="mx-auto max-w-[1700px]">
     <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
       <div><div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.2em] text-indigo-600"><span className="size-2 rounded-full bg-emerald-500"/> Live sales workspace</div><h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Point of Sale</h1><p className="mt-1 text-sm text-slate-500">Find products, build an order and serve the next customer.</p></div>
       <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><div className="hidden rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 sm:block">● Register ready</div><label className="flex items-center gap-2 text-xs font-semibold text-slate-500"><span className="hidden sm:inline">Selling from</span><select aria-label="Sales branch" className="max-w-44 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300" value={branch} onChange={e=>{if(e.target.value!==branch){if(cart.length&&!window.confirm('Changing branch will clear the current cart. Continue?'))return;setCart([]);setCheckout(false);setBranch(e.target.value)}}}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
     </div>
     {error&&<div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button className="font-bold underline" onClick={()=>setError('')}>Dismiss</button></div>}
     <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">
       <section className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_28px_rgba(15,23,42,.04)]">
         <div className="border-b border-slate-100 p-4 sm:p-6">
           <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Product catalogue</h2><p className="text-xs text-slate-500">Select an item to add it to the sale</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{filtered.length} shown</span></div>
           <div className="flex items-center gap-3 rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 px-4 py-3 transition focus-within:border-indigo-400 focus-within:bg-white"><ScanBarcode size={22} className="shrink-0 text-indigo-600"/><input autoFocus className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-slate-400" value={query} onChange={e=>{setQuery(e.target.value);setCategory('')}} placeholder="Scan barcode, search title, ISBN or SKU…" aria-label="Search products"/>{query&&<button onClick={()=>setQuery('')} aria-label="Clear search" className="rounded-full p-1 hover:bg-slate-100"><X size={16}/></button>}<kbd className="hidden rounded-md border bg-white px-2 py-1 text-[10px] text-slate-400 sm:block">SEARCH</kbd></div>
           <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{['',...categories].map(c=><button key={c||'all'} onClick={()=>setCategory(c)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${category===c?'bg-indigo-600 text-white shadow-sm':'bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'}`}>{c||'All products'}</button>)}</div>
         </div>
         <div className="flex items-center justify-between px-4 pt-4 text-xs text-slate-500 sm:px-6"><span>{loading?'Updating catalogue…':'Tap a product to add it to your basket'}</span>{lowStock>0&&<span className="font-semibold text-amber-600">{lowStock} low-stock items</span>}</div>
         <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3 2xl:grid-cols-4">
           {filtered.map(p=>{const available=Number(p.available),inCart=cart.find(i=>i.product.id===p.id)?.quantity||0;return <button key={p.id} disabled={available<=0} onClick={()=>add(p)} className="group relative flex min-h-48 flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-100/70 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-55">
             <div className="mb-3 flex items-start justify-between"><span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-100 text-indigo-600"><BookOpen size={23}/></span>{inCart>0?<span className="rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white">{inCart} in cart</span>:<span className={`rounded-full px-2 py-1 text-[10px] font-bold ${available<=0?'bg-rose-50 text-rose-600':available<=5?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`}>{available<=0?'Out of stock':available<=5?'Low stock':available+' available'}</span>}</div>
             <span className="mb-1 line-clamp-1 text-[10px] font-bold uppercase tracking-wide text-indigo-500">{p.subcategory||p.category||'Product'}</span><strong className="line-clamp-2 min-h-10 text-sm leading-5 text-slate-800">{p.title}</strong><span className="mt-1 truncate text-[11px] text-slate-400">{p.sku}</span>
             <div className="mt-auto flex items-end justify-between gap-2 pt-4"><span className="text-base font-extrabold tracking-tight">{money(Number(p.selling_price))}</span><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition group-hover:bg-indigo-600 group-hover:text-white"><Plus size={19}/></span></div>
           </button>})}
         </div>
         {!loading&&!filtered.length&&<div className="flex flex-col items-center gap-2 px-6 py-16 text-center"><Search size={28} className="text-slate-300"/><strong className="text-slate-700">No matching products</strong><p className="text-sm text-slate-400">Try another name, SKU or barcode.</p><button className="mt-2 text-sm font-bold text-indigo-600" onClick={()=>{setQuery('');setCategory('')}}>Clear filters</button></div>}
         {loading&&<div className="px-6 pb-8 text-sm text-slate-500">Loading products…</div>}
         {filtered.length===30&&<p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">Showing the first 30 results. Search to find more products.</p>}
       </section>
       <aside className={`min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_28px_rgba(15,23,42,.05)] lg:sticky lg:top-4 ${cartVisible?'block':'hidden lg:block'}`}>
         <div className="bg-[#182347] px-5 py-5 text-white sm:px-6"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold uppercase tracking-[.2em] text-indigo-200">Active transaction</span><h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold"><ShoppingBag size={22}/> Current sale</h2><p className="mt-1 text-xs text-slate-300">{itemCount} {itemCount===1?'item':'items'} · Walk-in customer</p></div>{cart.length>0&&<button className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10" onClick={()=>{if(window.confirm('Remove all products from this sale?'))setCart([])}}><Trash2 size={13}/> Clear</button>}</div></div>
         <div className="max-h-[45vh] min-h-52 overflow-y-auto px-5 py-4 sm:px-6 lg:max-h-[calc(100vh-440px)]">
           {cart.length===0?<div className="flex min-h-48 flex-col items-center justify-center text-center"><div className="mb-3 flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><ShoppingCart size={30}/></div><strong className="text-sm text-slate-700">Ready for the next customer</strong><p className="mt-1 max-w-52 text-xs leading-5 text-slate-400">Search or scan products to start building a sale.</p></div>:<div className="space-y-3">{cart.map(i=><div key={i.product.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><strong className="line-clamp-2 text-sm text-slate-800">{i.product.title}</strong><span className="mt-1 block text-[11px] text-slate-500">{money(Number(i.product.selling_price))} each</span></div><button aria-label={'Remove '+i.product.title} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={()=>setCart(items=>items.filter(x=>x.product.id!==i.product.id))}><X size={16}/></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white"><button aria-label="Decrease quantity" className="p-2 hover:bg-slate-100" onClick={()=>quantity(i.product.id,-1)}><Minus size={14}/></button><span className="min-w-9 text-center text-sm font-bold">{i.quantity}</span><button aria-label="Increase quantity" className="p-2 hover:bg-slate-100" onClick={()=>quantity(i.product.id,1)}><Plus size={14}/></button></div><strong className="text-sm">{money(Number(i.product.selling_price)*i.quantity)}</strong></div></div>)}</div>}
         </div>
         <div className="border-t border-slate-200 bg-white px-5 py-5 sm:px-6"><div className="mb-3 flex justify-between text-sm text-slate-500"><span>Subtotal</span><span className="font-semibold text-slate-800">{money(subtotal)}</span></div><div className="mb-4 flex justify-between text-xs text-slate-400"><span>Pricing</span><span>Catalogue selling prices</span></div><div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-4"><span className="text-sm font-bold">Amount due</span><strong className="text-2xl font-extrabold tracking-tight text-indigo-700">{money(subtotal)}</strong></div><button className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-4 text-sm font-extrabold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none" disabled={!cart.length||!branch} onClick={openCheckout}><Wallet size={19}/> Proceed to payment <ArrowRight size={18}/></button><div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-slate-400"><CheckCircle2 size={14} className="text-emerald-500"/> Draft automatically saved on this device</div></div>
       </aside>
     </div>
   </div>
   <button className="fixed bottom-4 left-4 right-4 z-20 flex items-center justify-between rounded-2xl bg-[#182347] px-5 py-4 text-white shadow-2xl lg:hidden" onClick={()=>setCartVisible(v=>!v)}><span className="flex items-center gap-2 text-sm font-bold"><ShoppingCart size={19}/> {cartVisible?'Hide cart':'View cart'} ({itemCount})</span><strong>{money(subtotal)}</strong></button>
   {checkout&&<div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Complete sale"><div className="modal-header"><div><div className="eyebrow">SECURE CHECKOUT</div><h2>Complete sale</h2></div><button className="icon-button" disabled={busy} onClick={()=>setCheckout(false)}><X size={18}/></button></div><div className="checkout-total"><span>Amount due</span><strong>{money(subtotal)}</strong></div><div className="payment-tabs">{(['cash','mpesa','card'] as const).map(m=><button key={m} className={payment===m?'selected':''} onClick={()=>{setPayment(m);setReceived(subtotal.toFixed(2))}}>{m==='cash'?'Cash':m==='mpesa'?'M-Pesa':'Card'}</button>)}</div>{payment!=='cash'&&<label className="field-label">Transaction reference<input className="text-input" value={reference} onChange={e=>setReference(e.target.value)} placeholder="Enter payment reference"/></label>}<label className="field-label">Amount received<input className="text-input" type="number" min={subtotal} step="0.01" value={received} onChange={e=>setReceived(e.target.value)}/></label><div className="change-row"><span>Change due</span><strong>{money(Math.max(0,Number(received||0)-subtotal))}</strong></div><button className="primary-button full" disabled={busy||Number(received)<subtotal||(payment!=='cash'&&!reference.trim())} onClick={()=>void complete()}>{busy?'Processing…':'Confirm payment'} <ArrowRight size={16}/></button><p className="secure-note">M-Pesa and card payments are recorded manually, not verified through a gateway.</p></div></div>}
   {receipt&&<div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Sale receipt"><div className="modal-header"><div><div className="eyebrow">PAYMENT SUCCESSFUL</div><h2 className="flex items-center gap-2"><CheckCircle2 size={21} className="text-emerald-600"/> Sale completed</h2></div><button className="icon-button" onClick={()=>setReceipt(null)}><X size={18}/></button></div><p className="py-3 text-sm text-slate-500">Receipt {receipt.sale.receipt_number}</p><div className="checkout-total"><span>Total paid</span><strong>{money(Number(receipt.sale.total))}</strong></div><button className="primary-button full" onClick={printReceipt}><ReceiptText size={17}/> Print receipt</button><button className="secondary-button mt-3 w-full" onClick={()=>setReceipt(null)}>Start next sale</button></div></div>}
 </div>
}
