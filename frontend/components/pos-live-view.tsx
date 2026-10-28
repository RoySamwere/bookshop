'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronDown, CreditCard, Plus, Search, ShoppingCart, Users, X } from 'lucide-react'
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
 return <div className="pos-page">
   <div className="page-heading compact"><div><div className="eyebrow">SALES TERMINAL · LIVE INVENTORY</div><h1 tabIndex={-1}>Point of Sale</h1><p>Serve customers quickly and keep your records accurate.</p></div><div className="register-actions"><select className="text-input" aria-label="Sales branch" value={branch} onChange={e=>{if(e.target.value!==branch){setCart([]);setCheckout(false);setBranch(e.target.value)}}}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><div className="register-status"><span className="status-dot"/>Live catalogue</div></div></div>
   {error&&<div role="alert" className="mx-6 mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
   <div className="pos-layout"><section className="product-panel card"><div className="pos-search"><Search size={18}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by product, ISBN or SKU..."/><kbd>/</kbd></div>
   <div className="category-tabs"><button className={!category?'selected':''} onClick={()=>setCategory('')}>All products</button>{categories.map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c}</button>)}</div>
   <div className="product-grid">{filtered.map(p=><button className="product-card" key={p.id} onClick={()=>add(p)} disabled={Number(p.available)<=0}><div className="product-art teal"><BookOpen size={24}/><span>{p.subcategory||p.category||'PRODUCT'}</span></div><div className="product-info"><strong>{p.title}</strong><span>{p.sku} · {Number(p.available)<=0?'Out of stock':`${p.available} in stock`}</span><b>{money(Number(p.selling_price))}</b></div><Plus className="add-icon" size={17}/></button>)}</div>
   {loading&&<p className="p-4 text-sm">Loading products…</p>}{!loading&&!filtered.length&&<p className="p-4 text-sm">No products found in this branch.</p>}</section>
   <aside className="cart-panel card"><div className="cart-heading"><div><h2>Current sale</h2><span>{cart.reduce((n,i)=>n+i.quantity,0)} items</span></div>{cart.length>0&&<button className="clear-button" onClick={()=>setCart([])}>Clear</button>}</div>
   <div className="customer-select"><Users size={16}/><span>Walk-in customer</span><ChevronDown size={15}/></div>
   <div className="cart-items">{!cart.length?<div className="cart-empty"><ShoppingCart size={27}/><strong>Your cart is empty</strong><span>Select a product to start a sale</span></div>:cart.map(i=><div className="cart-item" key={i.product.id}><div className="mini-art teal"><BookOpen size={15}/></div><div className="cart-item-info"><strong>{i.product.title}</strong><span>{money(Number(i.product.selling_price))} each</span><div className="qty"><button onClick={()=>quantity(i.product.id,-1)}>−</button><b>{i.quantity}</b><button onClick={()=>quantity(i.product.id,1)}>+</button></div></div><strong>{money(Number(i.product.selling_price)*i.quantity)}</strong></div>)}</div>
   <div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Tax</span><b>Calculated from listed prices</b></div><div className="total-line"><span>Total due</span><strong>{money(subtotal)}</strong></div></div>
   <button className="primary-button full checkout-button" disabled={!cart.length||!branch} onClick={openCheckout}>Charge {money(subtotal)} <ArrowUpRight size={17}/></button><div className="payment-hint"><CreditCard size={15}/> Payment collected at checkout</div></aside></div>
   {checkout&&<div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Complete sale"><div className="modal-header"><div><div className="eyebrow">CHECKOUT</div><h2>Complete sale</h2></div><button className="icon-button" onClick={()=>!busy&&setCheckout(false)}><X size={18}/></button></div><div className="checkout-total"><span>Total due</span><strong>{money(subtotal)}</strong></div><div className="payment-tabs">{(['cash','mpesa','card'] as const).map(method=><button key={method} className={payment===method?'selected':''} onClick={()=>{setPayment(method);setReceived(subtotal.toFixed(2))}}>{method==='mpesa'?'M-Pesa':method==='cash'?'Cash':'Card'}</button>)}</div>
   {payment!=='cash'&&<label className="field-label">Transaction reference<input className="text-input" value={reference} onChange={e=>setReference(e.target.value)} placeholder="Payment reference"/></label>}
   <label className="field-label">Amount received<input className="text-input" type="number" min={subtotal} step="0.01" value={received} onChange={e=>setReceived(e.target.value)}/></label><div className="change-row"><span>Change due</span><strong>{money(Math.max(0,Number(received||0)-subtotal))}</strong></div><button className="primary-button full" disabled={busy||Number(received)<subtotal||(payment!=='cash'&&!reference.trim())} onClick={()=>void complete()}>{busy?'Processing…':'Confirm payment'} <ArrowUpRight size={16}/></button><p className="secure-note">M-Pesa and card payments are recorded manually; no gateway verification.</p></div></div>}
   {receipt&&<div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Sale receipt"><div className="modal-header"><h2>Sale completed</h2><button className="icon-button" onClick={()=>setReceipt(null)}><X size={18}/></button></div><p className="py-3">Receipt {receipt.sale.receipt_number}</p><div className="checkout-total"><span>Paid</span><strong>{money(Number(receipt.sale.total))}</strong></div><button className="primary-button full" onClick={printReceipt}>Print receipt</button></div></div>}
 </div>
}
