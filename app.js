const STORAGE_KEY = 'meu-financeiro-v1';
const APP_VERSION = '2.4';
const SCHEMA_VERSION = 4;
const DEFAULT_ACCOUNT_ID = 'account-default';

const DEFAULT_CATEGORIES = [
  'Alimentação','Casa','Transporte','Saúde','Lazer',
  'Assinaturas','Educação','Compras','Salário','Outros'
];

const INVESTMENT_TYPES = {
  reserve:'Reserva / Cofrinho',
  fixed_income:'Renda fixa',
  fii:'FII',
  etf:'ETF',
  stock:'Ação',
  fund:'Fundo de investimento',
  crypto:'Criptoativo',
  other:'Outro'
};

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
    categories: [...DEFAULT_CATEGORIES],
    investments: []
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

  const investments=Array.isArray(safe.investments)?safe.investments.map(normalizeInvestment).filter(i=>i.name):[];

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
    categories:categories.length?categories:[...DEFAULT_CATEGORIES],
    investments
  };
}


function normalizeInvestment(raw){
  raw=raw&&typeof raw==='object'?raw:{};
  const validInvestmentTypes=new Set(Object.keys(INVESTMENT_TYPES));
  const mode=raw.mode==='units'?'units':'value';
  const startDate=isIsoDate(raw.startDate)?raw.startDate:'';
  const normalizeOp=op=>{
    op=op&&typeof op==='object'?op:{};
    let type=String(op.type||'');
    if(mode==='units'){
      if(type==='contribution')type='buy';
      if(type==='withdrawal')type='sell';
      if(!['buy','sell','income'].includes(type))type='buy';
    }else{
      if(type==='buy')type='contribution';
      if(type==='sell')type='withdrawal';
      if(!['contribution','withdrawal','income'].includes(type))type='contribution';
    }
    return {
      id:String(op.id||uid()),
      type,
      date:isIsoDate(op.date)?op.date:(startDate||isoToday()),
      quantity:Math.max(0,Number(op.quantity)||0),
      unitPrice:Math.max(0,Number(op.unitPrice)||0),
      amount:Math.max(0,Number(op.amount)||0),
      fees:Math.max(0,Number(op.fees)||0),
      notes:String(op.notes||'').trim(),
      createdAt:op.createdAt||new Date().toISOString()
    };
  };
  let operations=Array.isArray(raw.operations)?raw.operations.map(normalizeOp):[];
  if(!operations.length){
    const legacyDate=startDate||isoToday();
    if(mode==='units'){
      const quantity=Math.max(0,Number(raw.quantity)||0);
      const avgPrice=Math.max(0,Number(raw.avgPrice)||0);
      if(quantity&&avgPrice)operations.push(normalizeOp({type:'buy',date:legacyDate,quantity,unitPrice:avgPrice,notes:'Posição migrada da V2.3'}));
    }else{
      const investedAmount=Math.max(0,Number(raw.investedAmount)||0);
      if(investedAmount)operations.push(normalizeOp({type:'contribution',date:legacyDate,amount:investedAmount,notes:'Posição migrada da V2.3'}));
    }
    const legacyIncome=Math.max(0,Number(raw.incomeReceived)||0);
    if(legacyIncome)operations.push(normalizeOp({type:'income',date:legacyDate,amount:legacyIncome,notes:'Rendimentos migrados da V2.3'}));
  }
  operations.sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    id:String(raw.id||uid()),
    type:validInvestmentTypes.has(raw.type)?raw.type:'other',
    mode,
    name:String(raw.name||'').trim(),
    ticker:String(raw.ticker||'').trim().toUpperCase(),
    institution:String(raw.institution||'').trim(),
    currentPrice:Math.max(0,Number(raw.currentPrice)||0),
    currentValue:Math.max(0,Number(raw.currentValue)||0),
    startDate,
    notes:String(raw.notes||'').trim(),
    updatedAt:raw.updatedAt||new Date().toISOString(),
    operations
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
function investmentStats(i,excludeOperationId=''){
  const ops=[...(i.operations||[])].filter(op=>op.id!==excludeOperationId).sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt).localeCompare(String(b.createdAt)));
  let quantity=0,cost=0,income=0,realized=0,contributions=0,withdrawals=0;
  if(i.mode==='units'){
    ops.forEach(op=>{
      if(op.type==='buy'){
        const q=Math.max(0,Number(op.quantity)||0),price=Math.max(0,Number(op.unitPrice)||0),fees=Math.max(0,Number(op.fees)||0);
        if(q&&price){quantity+=q;cost+=q*price+fees;}
      }else if(op.type==='sell'){
        const requested=Math.max(0,Number(op.quantity)||0),price=Math.max(0,Number(op.unitPrice)||0),fees=Math.max(0,Number(op.fees)||0);
        const q=Math.min(requested,quantity);
        if(q>0){const avg=quantity?cost/quantity:0;const removed=avg*q;const proceeds=q*price-fees;quantity-=q;cost=Math.max(0,cost-removed);realized+=proceeds-removed;}
      }else if(op.type==='income') income+=Math.max(0,Number(op.amount)||0);
    });
    if(quantity<1e-10){quantity=0;cost=0;}
    const avgPrice=quantity?cost/quantity:0;
    const currentPrice=Math.max(0,Number(i.currentPrice)||0);
    const current=quantity*(currentPrice||avgPrice);
    const unrealized=current-cost;
    return {quantity,cost,avgPrice,currentPrice,current,income,realized,unrealized,result:unrealized+realized+income,contributions:0,withdrawals:0};
  }
  ops.forEach(op=>{
    if(op.type==='contribution')contributions+=Math.max(0,Number(op.amount)||0);
    else if(op.type==='withdrawal')withdrawals+=Math.max(0,Number(op.amount)||0);
    else if(op.type==='income')income+=Math.max(0,Number(op.amount)||0);
  });
  cost=Math.max(0,contributions-withdrawals);
  const currentValue=Math.max(0,Number(i.currentValue)||0);
  const current=currentValue||cost;
  return {quantity:0,cost,avgPrice:0,currentPrice:0,current,income,realized:0,unrealized:current-cost,result:current-cost+income,contributions,withdrawals};
}
function investmentCost(i){return investmentStats(i).cost;}
function investmentCurrent(i){return investmentStats(i).current;}
function investmentResult(i){return investmentStats(i).result;}
function investmentTotals(){return state.investments.reduce((a,i)=>{const s=investmentStats(i);a.cost+=s.cost;a.current+=s.current;a.income+=s.income;a.realized+=s.realized;a.result+=s.result;return a;},{cost:0,current:0,income:0,realized:0,result:0});}
function investmentTypeName(type){return INVESTMENT_TYPES[type]||'Outro';}
function investmentOperationTypeName(i,type){
  if(type==='income')return i.mode==='units'?'Provento / rendimento':'Rendimento';
  if(i.mode==='units')return type==='sell'?'Venda':'Compra';
  return type==='withdrawal'?'Resgate':'Aporte';
}
function investmentOperationSummary(i,op){
  if(i.mode==='units'&&op.type!=='income')return `${formatQuantity(op.quantity)} × ${money(op.unitPrice)}${op.fees?` · taxas ${money(op.fees)}`:''}`;
  return money(op.amount);
}
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
    investments:[
      {id:uid(),type:'reserve',mode:'value',name:'Reserva de emergência',ticker:'',institution:'Nubank',currentPrice:0,currentValue:2540,startDate:monthDate(shiftMonth(mk,-4),10),notes:'Exemplo de cofrinho/reserva',updatedAt:new Date().toISOString(),operations:[{id:uid(),type:'contribution',date:monthDate(shiftMonth(mk,-4),10),quantity:0,unitPrice:0,amount:2500,fees:0,notes:'Aporte inicial',createdAt:new Date().toISOString()}]},
      {id:uid(),type:'etf',mode:'units',name:'ETF de exemplo',ticker:'ETF',institution:'Corretora',currentPrice:106,currentValue:0,startDate:monthDate(shiftMonth(mk,-2),15),notes:'Exemplo educativo',updatedAt:new Date().toISOString(),operations:[{id:uid(),type:'buy',date:monthDate(shiftMonth(mk,-2),15),quantity:10,unitPrice:100,amount:0,fees:0,notes:'Compra inicial',createdAt:new Date().toISOString()}]}
    ],
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
  const inv=investmentTotals();
  document.getElementById('homeInvestments').textContent=money(inv.current);
  document.getElementById('homeInvestmentsSub').textContent=state.investments.length?`${state.investments.length} posição${state.investments.length===1?'':'ões'}`:'Nenhum investimento';
  document.getElementById('netWorth').textContent=money(totalAvailableBalance()+inv.current);
  document.getElementById('netWorthSub').textContent='Contas + investimentos';

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

function renderInvestments(){
  const totals=investmentTotals();
  const result=totals.result;
  const pct=totals.cost?result/totals.cost*100:0;
  document.getElementById('investmentCostTotal').textContent=money(totals.cost);
  document.getElementById('investmentCurrentTotal').textContent=money(totals.current);
  const resultEl=document.getElementById('investmentResultTotal');
  resultEl.textContent=`${result>=0?'+':''}${money(result)}`;
  resultEl.className=`investment-kpi-value ${result>0?'positive':result<0?'negative':''}`;
  document.getElementById('investmentResultSub').textContent=totals.cost?`${pct>=0?'+':''}${pct.toFixed(1).replace('.',',')}% incluindo realizados e rendimentos`:'Sem posições';
  document.getElementById('investmentIncomeTotal').textContent=money(totals.income);

  const byType={};state.investments.forEach(i=>byType[i.type]=(byType[i.type]||0)+investmentCurrent(i));
  const allocation=Object.entries(byType).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(...allocation.map(x=>x[1]),1);
  document.getElementById('investmentAllocation').innerHTML=allocation.length?allocation.map(([type,val])=>`<div class="bar-row"><div class="bar-meta"><span>${escapeHtml(investmentTypeName(type))}</span><strong>${money(val)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,val/max*100)}%"></div></div></div>`).join(''):`<div class="empty">Cadastre seu primeiro investimento.</div>`;

  const q=document.getElementById('investmentSearch').value.trim().toLowerCase();
  const type=document.getElementById('investmentTypeFilter').value;
  const rows=[...state.investments].filter(i=>type==='all'||i.type===type).filter(i=>!q||`${i.name} ${i.ticker} ${i.institution} ${investmentTypeName(i.type)}`.toLowerCase().includes(q)).sort((a,b)=>investmentCurrent(b)-investmentCurrent(a));
  const list=document.getElementById('investmentList');
  list.innerHTML=rows.length?rows.map(i=>{
    const st=investmentStats(i),pct=st.cost?st.result/st.cost*100:0;
    const detail=i.mode==='units'?`${formatQuantity(st.quantity)} un. · PM ${money(st.avgPrice)}${i.currentPrice?` · atual ${money(i.currentPrice)}`:''}`:`Aplicado líquido ${money(st.cost)}${i.currentValue?` · atual ${money(i.currentValue)}`:''}`;
    const name=i.ticker?`${escapeHtml(i.ticker)} · ${escapeHtml(i.name)}`:escapeHtml(i.name);
    const ops=[...(i.operations||[])].sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt).localeCompare(String(a.createdAt)));
    const history=ops.length?ops.map(op=>`<div class="investment-operation"><div class="operation-main"><strong>${escapeHtml(investmentOperationTypeName(i,op.type))}</strong><span>${formatDate(op.date)} · ${escapeHtml(investmentOperationSummary(i,op))}${op.notes?` · ${escapeHtml(op.notes)}`:''}</span></div><div class="action-row"><button class="icon-btn edit-investment-operation" data-investment-id="${i.id}" data-operation-id="${op.id}" title="Editar operação">✎</button><button class="icon-btn delete-investment-operation" data-investment-id="${i.id}" data-operation-id="${op.id}" title="Excluir operação">🗑</button></div></div>`).join(''):`<div class="empty small-empty">Nenhuma operação registrada.</div>`;
    return `<article class="investment-card"><div class="investment-card-head"><div><div class="investment-badge">${escapeHtml(investmentTypeName(i.type))}</div><strong>${name}</strong><div class="item-sub">${escapeHtml(i.institution||'Instituição não informada')}${i.startDate?` · desde ${formatDate(i.startDate)}`:''}</div></div><div class="action-row"><button class="icon-btn edit-investment" data-id="${i.id}" title="Editar">✎</button><button class="icon-btn delete-investment" data-id="${i.id}" title="Excluir">🗑</button></div></div><div class="investment-values"><div><span>Valor atual</span><strong>${money(st.current)}</strong></div><div><span>Resultado total</span><strong class="${st.result>0?'positive':st.result<0?'negative':''}">${st.result>=0?'+':''}${money(st.result)}</strong></div></div><div class="item-sub">${detail}${st.income?` · rendimentos ${money(st.income)}`:''}${st.realized?` · realizado ${st.realized>=0?'+':''}${money(st.realized)}`:''}${st.cost?` · ${pct>=0?'+':''}${pct.toFixed(1).replace('.',',')}%`:''}</div>${i.notes?`<div class="investment-note">${escapeHtml(i.notes)}</div>`:''}<div class="investment-card-actions"><button class="secondary-btn add-investment-operation" data-id="${i.id}" type="button">＋ Operação</button></div><details class="investment-history"><summary>Histórico (${ops.length})</summary><div class="investment-operation-list">${history}</div></details></article>`;
  }).join(''):`<div class="empty">Nenhum investimento encontrado.</div>`;
  list.querySelectorAll('.edit-investment').forEach(b=>b.addEventListener('click',()=>openInvestmentDialog(state.investments.find(i=>i.id===b.dataset.id))));
  list.querySelectorAll('.delete-investment').forEach(b=>b.addEventListener('click',()=>deleteInvestment(b.dataset.id)));
  list.querySelectorAll('.add-investment-operation').forEach(b=>b.addEventListener('click',()=>openInvestmentOperationDialog(state.investments.find(i=>i.id===b.dataset.id))));
  list.querySelectorAll('.edit-investment-operation').forEach(b=>b.addEventListener('click',()=>{const i=state.investments.find(x=>x.id===b.dataset.investmentId);const op=i?.operations?.find(x=>x.id===b.dataset.operationId);if(i&&op)openInvestmentOperationDialog(i,op);}));
  list.querySelectorAll('.delete-investment-operation').forEach(b=>b.addEventListener('click',()=>deleteInvestmentOperation(b.dataset.investmentId,b.dataset.operationId)));
}
function formatQuantity(v){return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8}).format(Number(v)||0);}
function deleteInvestment(id){
  const idx=state.investments.findIndex(i=>i.id===id);if(idx<0)return;const item=state.investments[idx];const count=item.operations?.length||0;if(!confirm(`Excluir o investimento “${item.name}”${count?` e suas ${count} operação${count===1?'':'ões'}`:''}?`))return;state.investments.splice(idx,1);saveState();showToast('Investimento excluído','Desfazer',()=>{state.investments.splice(idx,0,item);saveState();showToast('Exclusão desfeita');});
}
function deleteInvestmentOperation(investmentId,operationId){
  const investment=state.investments.find(i=>i.id===investmentId);if(!investment)return;const idx=(investment.operations||[]).findIndex(op=>op.id===operationId);if(idx<0)return;const op=investment.operations[idx];if(!confirm(`Excluir esta operação de ${investmentOperationTypeName(investment,op.type).toLowerCase()}?`))return;investment.operations.splice(idx,1);investment.updatedAt=new Date().toISOString();saveState();showToast('Operação excluída','Desfazer',()=>{investment.operations.splice(idx,0,op);investment.updatedAt=new Date().toISOString();saveState();showToast('Exclusão desfeita');});
}

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

function renderAll(){fillFormOptions();renderFilterOptions();renderHome();renderTransactions();renderAccounts();renderCards();renderInvestments();renderBudgets();renderCategories();}

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
function updateInvestmentFields(){
  const mode=document.getElementById('investmentMode').value;
  document.getElementById('investmentUnitFields').classList.toggle('hidden',mode!=='units');
  document.getElementById('investmentValueFields').classList.toggle('hidden',mode!=='value');
}
function setInvestmentTypeDefaults(type){
  const mode=['stock','fii','etf','crypto'].includes(type)?'units':'value';
  const select=document.getElementById('investmentMode');
  if(!select.disabled)select.value=mode;
  updateInvestmentFields();
}
function openInvestmentDialog(item=null,preset=''){
  const f=document.getElementById('investmentForm');f.reset();document.getElementById('investmentEditId').value='';document.getElementById('investmentDialogTitle').textContent='Novo investimento';document.getElementById('investmentStartDate').value=isoToday();document.getElementById('investmentMode').disabled=false;
  const presetMap={reserve:{type:'reserve',name:'Cofrinho / reserva',institution:'Nubank'},fixed_income:{type:'fixed_income',name:'Renda fixa',institution:'Inter'},fii:{type:'fii',name:'FII'},etf:{type:'etf',name:'ETF'},stock:{type:'stock',name:'Ação'}};
  if(presetMap[preset]){const p=presetMap[preset];document.getElementById('investmentType').value=p.type;document.getElementById('investmentName').value=p.name;document.getElementById('investmentInstitution').value=p.institution||'';setInvestmentTypeDefaults(p.type);}else setInvestmentTypeDefaults('reserve');
  if(item){
    document.getElementById('investmentDialogTitle').textContent='Editar investimento';document.getElementById('investmentEditId').value=item.id;document.getElementById('investmentType').value=item.type;document.getElementById('investmentMode').value=item.mode;document.getElementById('investmentName').value=item.name;document.getElementById('investmentTicker').value=item.ticker||'';document.getElementById('investmentInstitution').value=item.institution||'';document.getElementById('investmentCurrentPrice').value=item.currentPrice?Number(item.currentPrice).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:8}):'';document.getElementById('investmentCurrentValue').value=item.currentValue?Number(item.currentValue).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';document.getElementById('investmentStartDate').value=item.startDate||'';document.getElementById('investmentNotes').value=item.notes||'';document.getElementById('investmentMode').disabled=Boolean(item.operations?.length);updateInvestmentFields();
  }
  document.getElementById('investmentDialog').showModal();
}
function populateInvestmentOperationTypes(investment,selected=''){
  const select=document.getElementById('investmentOperationType');
  const options=investment.mode==='units'?[['buy','Compra'],['sell','Venda'],['income','Provento / rendimento']]:[['contribution','Aporte'],['withdrawal','Resgate'],['income','Rendimento']];
  select.innerHTML=options.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  if(selected&&options.some(([v])=>v===selected))select.value=selected;
}
function updateInvestmentOperationFields(){
  const investment=state.investments.find(i=>i.id===document.getElementById('investmentOperationInvestmentId').value);if(!investment)return;
  const type=document.getElementById('investmentOperationType').value;
  const unitMode=investment.mode==='units'&&type!=='income';
  document.getElementById('investmentOperationUnitFields').classList.toggle('hidden',!unitMode);
  document.getElementById('investmentOperationAmountField').classList.toggle('hidden',unitMode);
  const label=document.getElementById('investmentOperationAmountLabel');
  label.textContent=type==='income'?'Valor recebido':type==='withdrawal'?'Valor resgatado':'Valor aportado';
  const hint=document.getElementById('investmentOperationHint');
  if(investment.mode==='units'){
    const st=investmentStats(investment,document.getElementById('investmentOperationEditId').value);
    hint.textContent=type==='sell'?`Disponível para venda: ${formatQuantity(st.quantity)} unidade(s).`:type==='buy'?'O preço médio será recalculado automaticamente.':'O rendimento entra no resultado, sem alterar a quantidade.';
  }else{
    const st=investmentStats(investment,document.getElementById('investmentOperationEditId').value);
    hint.textContent=type==='withdrawal'?`Aplicado líquido antes desta operação: ${money(st.cost)}.`:type==='contribution'?'O total aplicado será atualizado automaticamente.':'O rendimento entra no resultado, sem alterar o valor aplicado.';
  }
}
function openInvestmentOperationDialog(investment,operation=null){
  if(!investment)return;
  const f=document.getElementById('investmentOperationForm');f.reset();document.getElementById('investmentOperationInvestmentId').value=investment.id;document.getElementById('investmentOperationEditId').value='';document.getElementById('investmentOperationDialogTitle').textContent='Nova operação';document.getElementById('investmentOperationAsset').innerHTML=`<strong>${escapeHtml(investment.ticker||investment.name)}</strong><span>${escapeHtml(investmentTypeName(investment.type))} · ${escapeHtml(investment.institution||'Sem instituição')}</span>`;populateInvestmentOperationTypes(investment);document.getElementById('investmentOperationDate').value=isoToday();
  if(operation){document.getElementById('investmentOperationDialogTitle').textContent='Editar operação';document.getElementById('investmentOperationEditId').value=operation.id;populateInvestmentOperationTypes(investment,operation.type);document.getElementById('investmentOperationDate').value=operation.date;document.getElementById('investmentOperationQuantity').value=operation.quantity?formatQuantity(operation.quantity):'';document.getElementById('investmentOperationUnitPrice').value=operation.unitPrice?Number(operation.unitPrice).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:8}):'';document.getElementById('investmentOperationFees').value=operation.fees?Number(operation.fees).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';document.getElementById('investmentOperationAmount').value=operation.amount?Number(operation.amount).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';document.getElementById('investmentOperationNotes').value=operation.notes||'';}
  updateInvestmentOperationFields();document.getElementById('investmentOperationDialog').showModal();
}

function openRenameCategory(category){document.getElementById('renameCategoryOld').value=category;document.getElementById('renameCategoryName').value=category;document.getElementById('renameCategoryDialog').showModal();setTimeout(()=>document.getElementById('renameCategoryName').select(),50);}
function openDialog(kind){if(kind==='transaction')openTransactionDialog();if(kind==='account')openAccountDialog();if(kind==='card')openCardDialog();if(kind==='investment')openInvestmentDialog();if(kind==='budget')document.getElementById('budgetDialog').showModal();}

// Navegação e abertura de modais
document.addEventListener('click',e=>{
  const opener=e.target.closest('[data-open]');if(opener)openDialog(opener.dataset.open);
  const close=e.target.closest('[data-close]');if(close)close.closest('dialog')?.close();
  const nav=e.target.closest('[data-view]');if(nav)switchView(nav.dataset.view);
  const preset=e.target.closest('[data-investment-preset]');if(preset)openInvestmentDialog(null,preset.dataset.investmentPreset);
});

document.querySelectorAll('input[name="txType"]').forEach(r=>r.addEventListener('change',updateTransactionFields));
document.getElementById('txPaymentMethod').addEventListener('change',updateTransactionFields);
document.getElementById('investmentMode').addEventListener('change',updateInvestmentFields);
document.getElementById('investmentType').addEventListener('change',e=>setInvestmentTypeDefaults(e.target.value));
document.getElementById('investmentOperationType').addEventListener('change',updateInvestmentOperationFields);

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

document.getElementById('investmentForm').addEventListener('submit',e=>{
  e.preventDefault();const id=document.getElementById('investmentEditId').value;const existing=id?state.investments.find(i=>i.id===id):null;const mode=existing?.operations?.length?existing.mode:document.getElementById('investmentMode').value;const item={
    ...(existing||{}),id:existing?.id||uid(),type:document.getElementById('investmentType').value,mode,name:document.getElementById('investmentName').value.trim(),ticker:document.getElementById('investmentTicker').value.trim().toUpperCase(),institution:document.getElementById('investmentInstitution').value.trim(),currentPrice:mode==='units'?Math.abs(parseMoney(document.getElementById('investmentCurrentPrice').value)):0,currentValue:mode==='value'?Math.abs(parseMoney(document.getElementById('investmentCurrentValue').value)):0,startDate:document.getElementById('investmentStartDate').value,notes:document.getElementById('investmentNotes').value.trim(),operations:existing?.operations||[],updatedAt:new Date().toISOString()
  };
  if(!item.name){showToast('Informe o nome do investimento');return;}
  if(existing)state.investments[state.investments.findIndex(i=>i.id===id)]=item;else state.investments.push(item);saveState();document.getElementById('investmentDialog').close();showToast(existing?'Investimento atualizado':'Investimento criado. Registre a primeira operação.');
});

document.getElementById('investmentOperationForm').addEventListener('submit',e=>{
  e.preventDefault();
  const investment=state.investments.find(i=>i.id===document.getElementById('investmentOperationInvestmentId').value);if(!investment)return;
  const editId=document.getElementById('investmentOperationEditId').value;const existing=editId?investment.operations.find(op=>op.id===editId):null;const type=document.getElementById('investmentOperationType').value;const date=document.getElementById('investmentOperationDate').value;const quantity=Math.abs(parseMoney(document.getElementById('investmentOperationQuantity').value));const unitPrice=Math.abs(parseMoney(document.getElementById('investmentOperationUnitPrice').value));const fees=Math.abs(parseMoney(document.getElementById('investmentOperationFees').value));const amount=Math.abs(parseMoney(document.getElementById('investmentOperationAmount').value));
  if(!date){showToast('Informe a data da operação');return;}
  if(investment.mode==='units'&&type!=='income'){
    if(!quantity||!unitPrice){showToast('Informe quantidade e preço por unidade');return;}
    if(type==='sell'){
      const available=investmentStats(investment,editId).quantity;
      if(quantity>available+1e-10){showToast(`Venda maior que a posição disponível (${formatQuantity(available)})`);return;}
    }
  }else{
    if(!amount){showToast('Informe o valor da operação');return;}
    if(investment.mode==='value'&&type==='withdrawal'){
      const available=investmentStats(investment,editId).cost;
      if(amount>available+0.005){showToast(`Resgate maior que o aplicado líquido (${money(available)})`);return;}
    }
  }
  const op={id:existing?.id||uid(),type,date,quantity:investment.mode==='units'&&type!=='income'?quantity:0,unitPrice:investment.mode==='units'&&type!=='income'?unitPrice:0,amount:(investment.mode==='value'||type==='income')?amount:0,fees:investment.mode==='units'&&type!=='income'?fees:0,notes:document.getElementById('investmentOperationNotes').value.trim(),createdAt:existing?.createdAt||new Date().toISOString()};
  if(existing)investment.operations[investment.operations.findIndex(x=>x.id===editId)]=op;else investment.operations.push(op);
  investment.operations.sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt).localeCompare(String(b.createdAt)));
  if(!investment.startDate||date<investment.startDate)investment.startDate=date;
  investment.updatedAt=new Date().toISOString();saveState();document.getElementById('investmentOperationDialog').close();showToast(existing?'Operação atualizada':'Operação registrada');
});

document.getElementById('investmentSearch').addEventListener('input',renderInvestments);
document.getElementById('investmentTypeFilter').addEventListener('change',renderInvestments);

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

// Inicialização e migração silenciosa das versões anteriores para V2.4
ensureRecurringTransactions();
document.getElementById('monthFilter').value=currentMonthKey();
document.getElementById('txDate').value=isoToday();
persistState();
renderAll();
