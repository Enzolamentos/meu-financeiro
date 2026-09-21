const STORAGE_KEY = 'meu-financeiro-v1';
const APP_VERSION = '2.2';
const SCHEMA_VERSION = 2;
const DEFAULT_ACCOUNT_ID = 'account-default';

const DEFAULT_CATEGORIES = [
  'Alimentação','Casa','Transporte','Saúde','Lazer',
  'Assinaturas','Educação','Compras','Salário','Outros'
];

let state = loadState();
let selectedMonth = currentMonthKey();
let deferredPrompt = null;
let undoAction = null;

function blankState(){
  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: [],
    cards: [],
    accounts: [{id:DEFAULT_ACCOUNT_ID,name:'Conta principal',type:'checking',openingBalance:0}],
    budgets: {},
    categories: [...DEFAULT_CATEGORIES]
  };
}

function normalizeState(data){
  const base = blankState();
  const safe = data && typeof data === 'object' ? data : {};

  let accounts = Array.isArray(safe.accounts) ? safe.accounts.map(a=>({
    id:String(a.id||uid()),
    name:String(a.name||'Conta').trim() || 'Conta',
    type:['checking','savings','cash','investment'].includes(a.type) ? a.type : 'checking',
    openingBalance:Number(a.openingBalance)||0
  })) : [];
  if(!accounts.length) accounts=[...base.accounts];
  const fallbackAccountId = accounts[0].id;

  const cards = Array.isArray(safe.cards) ? safe.cards.map(c=>({
    id:String(c.id||uid()),
    name:String(c.name||'Cartão').trim() || 'Cartão',
    limit:Number(c.limit)||0,
    closeDay:clampDay(c.closeDay||5),
    dueDay:clampDay(c.dueDay||12)
  })) : [];
  const cardIds = new Set(cards.map(c=>c.id));
  const accountIds = new Set(accounts.map(a=>a.id));

  const rawTransactions = Array.isArray(safe.transactions) ? safe.transactions : [];
  const transactions = rawTransactions.map(raw=>{
    const id=String(raw.id||uid());
    const type=raw.type==='income'?'income':'expense';
    let paymentMethod = raw.paymentMethod;
    if(type==='income') paymentMethod='account';
    if(type==='expense' && !['debit','cash','credit'].includes(paymentMethod)) paymentMethod='debit';
    let accountId = raw.accountId && accountIds.has(String(raw.accountId)) ? String(raw.accountId) : fallbackAccountId;
    let cardId = raw.cardId && cardIds.has(String(raw.cardId)) ? String(raw.cardId) : '';
    if(paymentMethod==='credit' && !cardId){
      paymentMethod='debit';
      accountId=fallbackAccountId;
    }
    const recurring=Boolean(raw.recurring);
    const recurrenceGenerated=Boolean(raw.recurrenceGenerated);
    return {
      ...raw,
      id,
      type,
      description:String(raw.description||'').trim(),
      amount:Math.abs(Number(raw.amount)||0),
      category:String(raw.category||'Outros').trim()||'Outros',
      date:isIsoDate(raw.date)?raw.date:isoToday(),
      dueDate:isIsoDate(raw.dueDate)?raw.dueDate:'',
      paymentMethod,
      accountId,
      cardId:paymentMethod==='credit'?cardId:'',
      recurring,
      recurrenceGenerated,
      recurrenceMasterId:recurring ? String(raw.recurrenceMasterId || (recurrenceGenerated ? raw.recurrenceMasterId || '' : id)) : '',
      createdAt:raw.createdAt||new Date().toISOString()
    };
  });

  const budgets = safe.budgets && typeof safe.budgets === 'object' && !Array.isArray(safe.budgets) ? safe.budgets : {};
  const cleanBudgets={};
  Object.entries(budgets).forEach(([k,v])=>{ if(String(k).trim()) cleanBudgets[String(k).trim()]=Math.max(0,Number(v)||0); });

  const storedCategories = Array.isArray(safe.categories) ? safe.categories : DEFAULT_CATEGORIES;
  const referencedCategories = [...transactions.map(t=>t.category), ...Object.keys(cleanBudgets)];
  const categories=[...new Set([...storedCategories,...referencedCategories].map(c=>String(c||'').trim()).filter(Boolean))];

  return {
    ...base,
    ...safe,
    schemaVersion:SCHEMA_VERSION,
    transactions,
    cards,
    accounts,
    budgets:cleanBudgets,
    categories:categories.length?categories:[...DEFAULT_CATEGORIES]
  };
}

function loadState(){
  try{return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));}
  catch{return blankState();}
}
function persistState(){
  state=normalizeState(state);
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
}
function saveState(){persistState();renderAll();}

function money(v){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);}
function parseMoney(v){return Number(String(v).replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''))||0;}
function uid(){return crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());}
function isIsoDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''));}
function isoToday(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseLocalDate(s){return new Date(`${s}T12:00:00`);}
function dateIso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function monthKey(dateStr){if(!isIsoDate(dateStr))return ''; return dateStr.slice(0,7);}
function currentMonthKey(){return isoToday().slice(0,7);}
function formatDate(s){return s?parseLocalDate(s).toLocaleDateString('pt-BR'):'';}
function clampDay(day){return Math.min(31,Math.max(1,Number(day)||1));}
function daysInMonth(year,month0){return new Date(year,month0+1,0).getDate();}
function makeDate(year,month0,day){return new Date(year,month0,Math.min(clampDay(day),daysInMonth(year,month0)),12);}
function monthParts(key){const [y,m]=key.split('-').map(Number);return {year:y,month0:m-1};}
function shiftMonth(key,delta){const {year,month0}=monthParts(key);const d=new Date(year,month0+delta,1,12);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function monthLabel(key){const {year,month0}=monthParts(key);return new Date(year,month0,1,12).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});}
function monthDate(key,day){const {year,month0}=monthParts(key);return dateIso(makeDate(year,month0,day));}
function escapeHtml(str){return String(str).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));}

function showToast(message,actionLabel='',action=null){
  const toast=document.getElementById('toast');
  const text=document.getElementById('toastText');
  const btn=document.getElementById('toastAction');
  text.textContent=message;
  undoAction=action;
  btn.textContent=actionLabel;
  btn.classList.toggle('hidden',!actionLabel||!action);
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{toast.classList.remove('show');undoAction=null;},4200);
}

function ensureRecurringTransactions(){
  const today=isoToday();
  const current=currentMonthKey();
  let changed=false;
  const masters=state.transactions.filter(t=>t.recurring && !t.recurrenceGenerated);
  masters.forEach(master=>{
    const start=monthKey(master.date);
    if(!start||start>=current) return;
    const startDay=Number(master.date.slice(8,10));
    const dueDay=master.dueDate?Number(master.dueDate.slice(8,10)):0;
    let mk=shiftMonth(start,1);
    let guard=0;
    while(mk<=current && guard<36){
      const occurrenceDate=monthDate(mk,startDay);
      if(occurrenceDate<=today){
        const exists=state.transactions.some(t=>t.recurrenceMasterId===master.id && monthKey(t.date)===mk);
        if(!exists){
          state.transactions.push({
            ...master,
            id:uid(),
            date:occurrenceDate,
            dueDate:dueDay?monthDate(mk,dueDay):'',
            recurrenceMasterId:master.id,
            recurrenceGenerated:true,
            createdAt:new Date().toISOString()
          });
          changed=true;
        }
      }
      mk=shiftMonth(mk,1); guard++;
    }
  });
  if(changed) persistState();
}

function accountById(id){return state.accounts.find(a=>a.id===id);}
function cardById(id){return state.cards.find(c=>c.id===id);}
function accountBalance(accountId){
  const account=accountById(accountId); if(!account)return 0;
  return state.transactions.reduce((sum,t)=>{
    if(t.accountId!==accountId) return sum;
    if(t.type==='income') return sum+Number(t.amount);
    if(t.type==='expense' && t.paymentMethod!=='credit') return sum-Number(t.amount);
    return sum;
  },Number(account.openingBalance)||0);
}
function totalAvailableBalance(){return state.accounts.reduce((s,a)=>s+accountBalance(a.id),0);}
function monthTransactions(key=selectedMonth){return state.transactions.filter(t=>monthKey(t.date)===key);}
function totals(key=selectedMonth){
  return monthTransactions(key).reduce((a,t)=>{a[t.type]+=Number(t.amount)||0;return a;},{income:0,expense:0});
}
function sourceName(t){
  if(t.paymentMethod==='credit') return cardById(t.cardId)?.name || 'Cartão de crédito';
  const acc=accountById(t.accountId)?.name || 'Conta';
  if(t.type==='income') return acc;
  return `${acc} · ${t.paymentMethod==='cash'?'Dinheiro':'Débito/Pix'}`;
}

function cardCycleForPurchase(dateStr,card){
  const p=parseLocalDate(dateStr);
  let close=makeDate(p.getFullYear(),p.getMonth(),card.closeDay);
  if(p>close) close=makeDate(p.getFullYear(),p.getMonth()+1,card.closeDay);
  let due;
  if(card.dueDay>card.closeDay) due=makeDate(close.getFullYear(),close.getMonth(),card.dueDay);
  else due=makeDate(close.getFullYear(),close.getMonth()+1,card.dueDay);
  return {closeDate:dateIso(close),dueDate:dateIso(due)};
}
function openCardCycle(card){
  const today=parseLocalDate(isoToday());
  let close=makeDate(today.getFullYear(),today.getMonth(),card.closeDay);
  if(today>close) close=makeDate(today.getFullYear(),today.getMonth()+1,card.closeDay);
  let due=card.dueDay>card.closeDay?makeDate(close.getFullYear(),close.getMonth(),card.dueDay):makeDate(close.getFullYear(),close.getMonth()+1,card.dueDay);
  return {closeDate:dateIso(close),dueDate:dateIso(due)};
}
function openInvoiceAmount(card){
  const cycle=openCardCycle(card);
  return state.transactions.filter(t=>t.type==='expense'&&t.paymentMethod==='credit'&&t.cardId===card.id)
    .filter(t=>cardCycleForPurchase(t.date,card).closeDate===cycle.closeDate)
    .reduce((s,t)=>s+Number(t.amount),0);
}

function seedData(){
  const accountId=uid();
  const cardId=uid();
  const mk=currentMonthKey();
  state={
    schemaVersion:SCHEMA_VERSION,
    accounts:[{id:accountId,name:'Conta principal',type:'checking',openingBalance:1500}],
    cards:[{id:cardId,name:'Cartão opcional',limit:5000,closeDay:5,dueDay:12}],
    categories:[...DEFAULT_CATEGORIES],
    budgets:{Alimentação:1200,Transporte:700,Lazer:500,Assinaturas:350},
    transactions:[
      makeSeed('income','Salário',7500,'Salário',monthDate(mk,5),'',true,'account',accountId,''),
      makeSeed('expense','Supermercado',620.40,'Alimentação',monthDate(mk,8),'',false,'debit',accountId,''),
      makeSeed('expense','Internet',119.90,'Assinaturas',monthDate(mk,10),monthDate(mk,25),true,'debit',accountId,''),
      makeSeed('expense','Combustível',280,'Transporte',monthDate(mk,12),'',false,'debit',accountId,''),
      makeSeed('expense','Academia',129.90,'Saúde',monthDate(mk,15),monthDate(mk,28),true,'debit',accountId,'')
    ]
  };
  saveState();showToast('Dados de exemplo carregados');
}
function makeSeed(type,description,amount,category,date,dueDate,recurring,paymentMethod,accountId,cardId){
  const id=uid();return {id,type,description,amount,category,date,dueDate,recurring,paymentMethod,accountId,cardId,recurrenceGenerated:false,recurrenceMasterId:recurring?id:'',createdAt:new Date().toISOString()};
}

function renderHome(){
  const month=totals(selectedMonth);
  document.getElementById('totalBalance').textContent=money(totalAvailableBalance());
  document.getElementById('monthIncome').textContent=money(month.income);
  document.getElementById('monthExpense').textContent=money(month.expense);
  document.getElementById('monthLabel').textContent=monthLabel(selectedMonth);

  const expenses={};
  monthTransactions(selectedMonth).filter(t=>t.type==='expense').forEach(t=>expenses[t.category]=(expenses[t.category]||0)+Number(t.amount));
  const entries=Object.entries(expenses).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(...entries.map(x=>x[1]),1);
  document.getElementById('categoryBars').innerHTML=entries.length?entries.slice(0,6).map(([cat,val])=>`
    <div class="bar-row"><div class="bar-meta"><span>${escapeHtml(cat)}</span><strong>${money(val)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,(val/max)*100)}%"></div></div></div>`).join(''):
    `<div class="empty">Nenhum gasto lançado neste mês.</div>`;

  const budgetLimit=Object.values(state.budgets).reduce((s,v)=>s+Number(v),0);
  const budgetSpent=Object.entries(state.budgets).reduce((s,[cat])=>s+(expenses[cat]||0),0);
  document.getElementById('budgetUsage').textContent=budgetLimit?`${Math.round((budgetSpent/budgetLimit)*100)}%`:'—';
  document.getElementById('budgetUsageSub').textContent=budgetLimit?`${money(budgetSpent)} de ${money(budgetLimit)}`:'Sem limites definidos';
  document.getElementById('topCategory').textContent=entries[0]?.[0]||'—';
  document.getElementById('topCategorySub').textContent=entries[0]?money(entries[0][1]):'Sem gastos no mês';

  const today=parseLocalDate(isoToday());const next=new Date(today);next.setDate(next.getDate()+30);
  const upcoming=state.transactions.filter(t=>t.type==='expense'&&t.dueDate)
    .map(t=>({...t,d:parseLocalDate(t.dueDate)})).filter(t=>t.d>=today&&t.d<=next).sort((a,b)=>a.d-b.d).slice(0,5);
  document.getElementById('upcomingList').innerHTML=upcoming.length?upcoming.map(t=>listItemHtml(t,true)).join(''):`<div class="empty">Nenhum vencimento nos próximos 30 dias.</div>`;
}

function listItemHtml(t,useDue=false){
  return `<div class="list-item"><div class="item-main"><div class="item-title">${escapeHtml(t.description)}</div><div class="item-sub">${escapeHtml(t.category)} · ${escapeHtml(sourceName(t))} · ${formatDate(useDue?t.dueDate:t.date)}${t.recurring?' · recorrente':''}</div></div><div class="amount ${t.type}">${t.type==='expense'?'−':'+'}${money(t.amount)}</div></div>`;
}

function renderTransactions(){
  const q=document.getElementById('searchInput').value.trim().toLowerCase();
  const type=document.getElementById('typeFilter').value;
  const month=document.getElementById('monthFilter').value;
  const category=document.getElementById('categoryFilter').value;
  const source=document.getElementById('sourceFilter').value;
  const rows=[...state.transactions]
    .filter(t=>type==='all'||t.type===type)
    .filter(t=>!month||monthKey(t.date)===month)
    .filter(t=>category==='all'||t.category===category)
    .filter(t=>source==='all'||(source.startsWith('account:')&&t.accountId===source.slice(8)&&t.paymentMethod!=='credit')||(source.startsWith('card:')&&t.cardId===source.slice(5)&&t.paymentMethod==='credit'))
    .filter(t=>!q||`${t.description} ${t.category} ${sourceName(t)}`.toLowerCase().includes(q))
    .sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt).localeCompare(String(a.createdAt)));
  document.getElementById('transactionList').innerHTML=rows.length?rows.map(t=>`
    <div class="list-item transaction-row" data-id="${t.id}">
      <div class="item-main"><div class="item-title">${escapeHtml(t.description)}</div><div class="item-sub">${escapeHtml(t.category)} · ${escapeHtml(sourceName(t))} · ${formatDate(t.date)}${t.recurring?' · recorrente':''}${t.recurrenceGenerated?' · automático':''}</div></div>
      <div class="item-actions"><div class="amount ${t.type}">${t.type==='expense'?'−':'+'}${money(t.amount)}</div><div class="action-row"><button class="icon-btn edit-tx" data-id="${t.id}" title="Editar">✎</button><button class="icon-btn delete-tx" data-id="${t.id}" title="Excluir">🗑</button></div></div>
    </div>`).join(''):`<div class="empty">Nenhum lançamento encontrado.</div>`;
  document.querySelectorAll('.edit-tx').forEach(btn=>btn.addEventListener('click',()=>openTransactionDialog(state.transactions.find(t=>t.id===btn.dataset.id))));
  document.querySelectorAll('.delete-tx').forEach(btn=>btn.addEventListener('click',()=>deleteTransaction(btn.dataset.id)));
}

function deleteTransaction(id){
  const idx=state.transactions.findIndex(t=>t.id===id);if(idx<0)return;
  const tx=state.transactions[idx];
  const msg=tx.recurring&&!tx.recurrenceGenerated?'Excluir este lançamento? Isso também interrompe novas repetições automáticas dessa recorrência.':'Excluir este lançamento?';
  if(!confirm(msg))return;
  state.transactions.splice(idx,1);saveState();
  showToast('Lançamento excluído','Desfazer',()=>{state.transactions.splice(Math.min(idx,state.transactions.length),0,tx);saveState();showToast('Exclusão desfeita');});
}

function renderAccounts(){
  const list=document.getElementById('accountsList');
  list.innerHTML=state.accounts.length?state.accounts.map(a=>{
    const used=state.transactions.some(t=>t.accountId===a.id);
    return `<div class="account-card"><div><div class="muted small">${accountTypeName(a.type)}</div><strong>${escapeHtml(a.name)}</strong><div class="account-balance">${money(accountBalance(a.id))}</div></div><div class="account-actions"><button class="icon-btn edit-account" data-id="${a.id}" title="Editar">✎</button><button class="icon-btn delete-account" data-id="${a.id}" ${used?'disabled':''} title="${used?'Conta em uso':'Excluir'}">🗑</button></div></div>`;
  }).join(''):`<div class="empty">Nenhuma conta cadastrada.</div>`;
  list.querySelectorAll('.edit-account').forEach(b=>b.addEventListener('click',()=>openAccountDialog(accountById(b.dataset.id))));
  list.querySelectorAll('.delete-account:not(:disabled)').forEach(b=>b.addEventListener('click',()=>deleteAccount(b.dataset.id)));
}
function accountTypeName(type){return {checking:'Conta corrente / digital',savings:'Poupança',cash:'Dinheiro / carteira',investment:'Investimentos'}[type]||'Conta';}
function deleteAccount(id){
  if(state.accounts.length<=1){showToast('Mantenha pelo menos uma conta');return;}
  const idx=state.accounts.findIndex(a=>a.id===id);if(idx<0)return;
  const item=state.accounts[idx];if(!confirm(`Excluir a conta “${item.name}”?`))return;
  state.accounts.splice(idx,1);saveState();showToast('Conta excluída','Desfazer',()=>{state.accounts.splice(idx,0,item);saveState();showToast('Exclusão desfeita');});
}

function renderCards(){
  const list=document.getElementById('cardsList');
  list.innerHTML=state.cards.length?state.cards.map(c=>{
    const used=openInvoiceAmount(c);const cycle=openCardCycle(c);const pct=Math.min(100,c.limit?used/c.limit*100:0);const referenced=state.transactions.some(t=>t.cardId===c.id&&t.paymentMethod==='credit');
    return `<div class="card-box"><div class="card-top"><div><div class="muted">Cartão de crédito</div><strong>${escapeHtml(c.name)}</strong></div><div class="action-row"><button class="icon-btn edit-card" data-id="${c.id}" title="Editar">✎</button><button class="icon-btn delete-card" data-id="${c.id}" ${referenced?'disabled':''} title="${referenced?'Cartão em uso':'Excluir'}">🗑</button></div></div><div class="card-limit">${money(used)} <span class="muted">/ ${money(c.limit)}</span></div><div class="progress"><div style="width:${pct}%"></div></div><div class="item-sub card-sub">Fatura aberta · fecha ${formatDate(cycle.closeDate)} · vence ${formatDate(cycle.dueDate)}</div></div>`;
  }).join(''):`<div class="empty">Nenhum cartão de crédito cadastrado. Se você usa só débito, está tudo certo.</div>`;
  list.querySelectorAll('.edit-card').forEach(b=>b.addEventListener('click',()=>openCardDialog(cardById(b.dataset.id))));
  list.querySelectorAll('.delete-card:not(:disabled)').forEach(b=>b.addEventListener('click',()=>deleteCard(b.dataset.id)));
}
function deleteCard(id){const idx=state.cards.findIndex(c=>c.id===id);if(idx<0)return;const item=state.cards[idx];if(!confirm(`Excluir o cartão “${item.name}”?`))return;state.cards.splice(idx,1);saveState();showToast('Cartão excluído','Desfazer',()=>{state.cards.splice(idx,0,item);saveState();showToast('Exclusão desfeita');});}

function renderBudgets(){
  document.getElementById('budgetMonthLabel').textContent=monthLabel(selectedMonth);
  const spent={};monthTransactions(selectedMonth).filter(t=>t.type==='expense').forEach(t=>spent[t.category]=(spent[t.category]||0)+Number(t.amount));
  const entries=Object.entries(state.budgets).sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'));
  document.getElementById('budgetList').innerHTML=entries.length?entries.map(([cat,limit])=>{const val=spent[cat]||0;const pct=Math.min(100,limit?val/limit*100:0);return `<div class="list-item"><div class="budget-line"><div class="budget-head"><strong>${escapeHtml(cat)}</strong><span>${money(val)} / ${money(limit)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div></div>`;}).join(''):`<div class="empty">Nenhum orçamento definido.</div>`;
}

function renderCategories(){
  const list=document.getElementById('categoryList');
  list.innerHTML=state.categories.map(cat=>{
    const inTransactions=state.transactions.some(t=>t.category===cat);const inBudgets=Object.prototype.hasOwnProperty.call(state.budgets,cat);const inUse=inTransactions||inBudgets;
    return `<div class="category-row"><span>${escapeHtml(cat)}</span><div class="action-row"><button class="category-edit" type="button" data-category="${escapeHtml(cat)}">Renomear</button><button class="category-delete" type="button" data-category="${escapeHtml(cat)}" ${inUse?'disabled':''} title="${inUse?'Categoria em uso':'Excluir categoria'}">${inUse?'Em uso':'Excluir'}</button></div></div>`;
  }).join('');
  list.querySelectorAll('.category-edit').forEach(btn=>btn.addEventListener('click',()=>openRenameCategory(btn.dataset.category)));
  list.querySelectorAll('.category-delete:not(:disabled)').forEach(btn=>btn.addEventListener('click',()=>{const cat=btn.dataset.category;if(!confirm(`Excluir a categoria “${cat}”?`))return;const idx=state.categories.indexOf(cat);state.categories=state.categories.filter(c=>c!==cat);saveState();showToast('Categoria excluída','Desfazer',()=>{state.categories.splice(Math.max(0,idx),0,cat);saveState();showToast('Exclusão desfeita');});}));
}

function renderFilterOptions(){
  const catSelect=document.getElementById('categoryFilter');const currentCat=catSelect.value||'all';
  catSelect.innerHTML='<option value="all">Todas as categorias</option>'+state.categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');if([...catSelect.options].some(o=>o.value===currentCat))catSelect.value=currentCat;
  const sourceSelect=document.getElementById('sourceFilter');const currentSource=sourceSelect.value||'all';
  sourceSelect.innerHTML='<option value="all">Todas as contas/cartões</option><optgroup label="Contas">'+state.accounts.map(a=>`<option value="account:${a.id}">${escapeHtml(a.name)}</option>`).join('')+'</optgroup>'+(state.cards.length?'<optgroup label="Cartões">'+state.cards.map(c=>`<option value="card:${c.id}">${escapeHtml(c.name)}</option>`).join('')+'</optgroup>':'');if([...sourceSelect.options].some(o=>o.value===currentSource))sourceSelect.value=currentSource;
}

function fillFormOptions(){
  ['txCategory','budgetCategory'].forEach(id=>{const select=document.getElementById(id);const current=select.value;select.innerHTML=state.categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');if(state.categories.includes(current))select.value=current;});
  const acc=document.getElementById('txAccount');const accCurrent=acc.value;acc.innerHTML=state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)} · ${money(accountBalance(a.id))}</option>`).join('');if(state.accounts.some(a=>a.id===accCurrent))acc.value=accCurrent;
  const card=document.getElementById('txCard');const cardCurrent=card.value;card.innerHTML=state.cards.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');if(state.cards.some(c=>c.id===cardCurrent))card.value=cardCurrent;
}

function renderAll(){fillFormOptions();renderFilterOptions();renderHome();renderTransactions();renderAccounts();renderCards();renderBudgets();renderCategories();}

function switchView(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));const target=document.getElementById(`view-${view}`);if(target)target.classList.add('active');
  document.querySelectorAll('.nav-btn[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  window.scrollTo({top:0,behavior:'smooth'});
}

function resetTransactionForm(){
  const f=document.getElementById('transactionForm');f.reset();document.getElementById('txEditId').value='';document.getElementById('txDate').value=isoToday();document.getElementById('transactionDialogTitle').textContent='Novo lançamento';updateTransactionFields();
}
function openTransactionDialog(tx=null){
  resetTransactionForm();
  if(tx){
    document.getElementById('transactionDialogTitle').textContent='Editar lançamento';document.getElementById('txEditId').value=tx.id;
    document.querySelector(`input[name="txType"][value="${tx.type}"]`).checked=true;
    document.getElementById('txDescription').value=tx.description;document.getElementById('txAmount').value=Number(tx.amount).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});document.getElementById('txCategory').value=tx.category;document.getElementById('txPaymentMethod').value=tx.paymentMethod==='account'?'debit':tx.paymentMethod;document.getElementById('txAccount').value=tx.accountId||state.accounts[0]?.id||'';document.getElementById('txCard').value=tx.cardId||state.cards[0]?.id||'';document.getElementById('txDate').value=tx.date;document.getElementById('txDueDate').value=tx.dueDate||'';document.getElementById('txRecurring').checked=Boolean(tx.recurring);updateTransactionFields();
  }
  document.getElementById('transactionDialog').showModal();
}
function updateTransactionFields(){
  const type=document.querySelector('input[name="txType"]:checked')?.value||'expense';const method=document.getElementById('txPaymentMethod').value;
  document.getElementById('paymentMethodLabel').classList.toggle('hidden',type==='income');
  document.getElementById('accountField').classList.toggle('hidden',type==='expense'&&method==='credit');
  document.getElementById('cardField').classList.toggle('hidden',!(type==='expense'&&method==='credit'));
}
function openAccountDialog(account=null){
  const f=document.getElementById('accountForm');f.reset();document.getElementById('accountEditId').value='';document.getElementById('accountDialogTitle').textContent='Nova conta';
  if(account){document.getElementById('accountDialogTitle').textContent='Editar conta';document.getElementById('accountEditId').value=account.id;document.getElementById('accountName').value=account.name;document.getElementById('accountType').value=account.type;document.getElementById('accountOpeningBalance').value=Number(account.openingBalance).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
  document.getElementById('accountDialog').showModal();
}
function openCardDialog(card=null){
  const f=document.getElementById('cardForm');f.reset();document.getElementById('cardEditId').value='';document.getElementById('cardDialogTitle').textContent='Novo cartão de crédito';document.getElementById('cardClose').value=5;document.getElementById('cardDue').value=12;
  if(card){document.getElementById('cardDialogTitle').textContent='Editar cartão';document.getElementById('cardEditId').value=card.id;document.getElementById('cardName').value=card.name;document.getElementById('cardLimit').value=Number(card.limit).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});document.getElementById('cardClose').value=card.closeDay;document.getElementById('cardDue').value=card.dueDay;}
  document.getElementById('cardDialog').showModal();
}
function openRenameCategory(category){document.getElementById('renameCategoryOld').value=category;document.getElementById('renameCategoryName').value=category;document.getElementById('renameCategoryDialog').showModal();setTimeout(()=>document.getElementById('renameCategoryName').select(),50);}
function openDialog(kind){if(kind==='transaction')openTransactionDialog();if(kind==='account')openAccountDialog();if(kind==='card')openCardDialog();if(kind==='budget')document.getElementById('budgetDialog').showModal();}

// Navegação e abertura de modais
document.addEventListener('click',e=>{
  const opener=e.target.closest('[data-open]');if(opener)openDialog(opener.dataset.open);
  const close=e.target.closest('[data-close]');if(close)close.closest('dialog')?.close();
  const nav=e.target.closest('[data-view]');if(nav)switchView(nav.dataset.view);
});

document.querySelectorAll('input[name="txType"]').forEach(r=>r.addEventListener('change',updateTransactionFields));
document.getElementById('txPaymentMethod').addEventListener('change',updateTransactionFields);

document.getElementById('transactionForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=document.getElementById('txEditId').value;const existing=id?state.transactions.find(t=>t.id===id):null;const type=document.querySelector('input[name="txType"]:checked').value;let paymentMethod=type==='income'?'account':document.getElementById('txPaymentMethod').value;
  if(paymentMethod==='credit'&&!state.cards.length){alert('Cadastre um cartão de crédito ou escolha Débito / Pix.');return;}
  const recurring=document.getElementById('txRecurring').checked;
  const tx={
    ...(existing||{}),id:existing?.id||uid(),type,description:document.getElementById('txDescription').value.trim(),amount:Math.abs(parseMoney(document.getElementById('txAmount').value)),category:document.getElementById('txCategory').value,date:document.getElementById('txDate').value,dueDate:document.getElementById('txDueDate').value,paymentMethod,accountId:paymentMethod==='credit'?'':document.getElementById('txAccount').value,cardId:paymentMethod==='credit'?document.getElementById('txCard').value:'',recurring,
    recurrenceGenerated:existing?.recurrenceGenerated||false,
    recurrenceMasterId:recurring?(existing?.recurrenceMasterId||existing?.id||''):'',
    createdAt:existing?.createdAt||new Date().toISOString()
  };
  if(!tx.description||!tx.amount||!tx.date)return;
  if(recurring&&!tx.recurrenceGenerated&&!tx.recurrenceMasterId)tx.recurrenceMasterId=tx.id;
  if(existing)state.transactions[state.transactions.findIndex(t=>t.id===existing.id)]=tx;else state.transactions.push(tx);
  saveState();document.getElementById('transactionDialog').close();showToast(existing?'Lançamento atualizado':'Lançamento salvo');
});

document.getElementById('accountForm').addEventListener('submit',e=>{
  e.preventDefault();const id=document.getElementById('accountEditId').value;const existing=id?accountById(id):null;const item={id:existing?.id||uid(),name:document.getElementById('accountName').value.trim(),type:document.getElementById('accountType').value,openingBalance:parseMoney(document.getElementById('accountOpeningBalance').value)};if(!item.name)return;
  if(existing)state.accounts[state.accounts.findIndex(a=>a.id===id)]=item;else state.accounts.push(item);saveState();document.getElementById('accountDialog').close();showToast(existing?'Conta atualizada':'Conta adicionada');
});

document.getElementById('cardForm').addEventListener('submit',e=>{
  e.preventDefault();const id=document.getElementById('cardEditId').value;const existing=id?cardById(id):null;const item={id:existing?.id||uid(),name:document.getElementById('cardName').value.trim(),limit:Math.abs(parseMoney(document.getElementById('cardLimit').value)),closeDay:clampDay(document.getElementById('cardClose').value),dueDay:clampDay(document.getElementById('cardDue').value)};if(!item.name||!item.limit)return;
  if(existing)state.cards[state.cards.findIndex(c=>c.id===id)]=item;else state.cards.push(item);saveState();document.getElementById('cardDialog').close();showToast(existing?'Cartão atualizado':'Cartão salvo');
});

document.getElementById('budgetForm').addEventListener('submit',e=>{e.preventDefault();const cat=document.getElementById('budgetCategory').value;state.budgets[cat]=Math.abs(parseMoney(document.getElementById('budgetAmount').value));saveState();e.currentTarget.reset();document.getElementById('budgetDialog').close();showToast('Orçamento salvo');});

document.getElementById('categoryForm').addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('categoryName');const name=input.value.trim().replace(/\s+/g,' ');if(!name)return;if(state.categories.some(c=>c.localeCompare(name,'pt-BR',{sensitivity:'accent'})===0)){showToast('Essa categoria já existe');return;}state.categories.push(name);state.categories.sort((a,b)=>a.localeCompare(b,'pt-BR'));input.value='';saveState();showToast('Categoria adicionada');});

document.getElementById('renameCategoryForm').addEventListener('submit',e=>{e.preventDefault();const old=document.getElementById('renameCategoryOld').value;const name=document.getElementById('renameCategoryName').value.trim().replace(/\s+/g,' ');if(!name||old===name){document.getElementById('renameCategoryDialog').close();return;}if(state.categories.some(c=>c!==old&&c.localeCompare(name,'pt-BR',{sensitivity:'accent'})===0)){showToast('Já existe uma categoria com esse nome');return;}state.categories=state.categories.map(c=>c===old?name:c);state.transactions.forEach(t=>{if(t.category===old)t.category=name;});if(Object.prototype.hasOwnProperty.call(state.budgets,old)){state.budgets[name]=state.budgets[old];delete state.budgets[old];}saveState();document.getElementById('renameCategoryDialog').close();showToast('Categoria renomeada');});

['searchInput','typeFilter','monthFilter','categoryFilter','sourceFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='searchInput'?'input':'change',renderTransactions));

document.getElementById('prevMonthBtn').addEventListener('click',()=>{selectedMonth=shiftMonth(selectedMonth,-1);renderHome();renderBudgets();});
document.getElementById('nextMonthBtn').addEventListener('click',()=>{selectedMonth=shiftMonth(selectedMonth,1);renderHome();renderBudgets();});
document.getElementById('budgetPrevMonthBtn').addEventListener('click',()=>{selectedMonth=shiftMonth(selectedMonth,-1);renderHome();renderBudgets();});
document.getElementById('budgetNextMonthBtn').addEventListener('click',()=>{selectedMonth=shiftMonth(selectedMonth,1);renderHome();renderBudgets();});
document.getElementById('monthLabel').addEventListener('click',()=>{selectedMonth=currentMonthKey();renderHome();renderBudgets();});

document.getElementById('toastAction').addEventListener('click',()=>{if(undoAction){const action=undoAction;undoAction=null;document.getElementById('toast').classList.remove('show');action();}});

document.getElementById('exportBtn').addEventListener('click',()=>{
  const payload={meta:{app:'Meu Financeiro',appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString()},data:state};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`meu-financeiro-backup-v${APP_VERSION}-${isoToday()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
});

document.getElementById('importInput').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{const parsed=JSON.parse(await file.text());const data=parsed?.data&&typeof parsed.data==='object'?parsed.data:parsed;if(!Array.isArray(data.transactions)||!data.budgets||typeof data.budgets!=='object')throw new Error('inválido');state=normalizeState(data);ensureRecurringTransactions();saveState();showToast(parsed?.meta?.exportedAt?`Backup de ${new Date(parsed.meta.exportedAt).toLocaleDateString('pt-BR')} importado`:'Backup antigo importado e atualizado');}
  catch{alert('Arquivo de backup inválido ou incompatível. Nenhum dado foi alterado.');}
  e.target.value='';
});

document.getElementById('seedBtn').addEventListener('click',()=>{if(confirm('Substituir os dados atuais por dados de exemplo?'))seedData();});
document.getElementById('clearBtn').addEventListener('click',()=>{if(confirm('Apagar todos os dados? Esta ação não pode ser desfeita.')){state=blankState();saveState();showToast('Dados apagados');}});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;document.getElementById('installBtn').classList.remove('hidden');});
document.getElementById('installBtn').addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;document.getElementById('installBtn').classList.add('hidden');});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'));

// Inicialização e migração silenciosa da V2.1 para V2.2
ensureRecurringTransactions();
document.getElementById('monthFilter').value=currentMonthKey();
document.getElementById('txDate').value=isoToday();
persistState();
renderAll();
