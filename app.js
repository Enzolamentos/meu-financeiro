
const STORAGE_KEY = 'meu-financeiro-v1';

const CATEGORIES = [
  'Alimentação','Casa','Transporte','Saúde','Lazer',
  'Assinaturas','Educação','Compras','Salário','Outros'
];

let state = loadState();
let deferredPrompt = null;

function blankState(){
  return { transactions: [], cards: [], budgets: {} };
}

function loadState(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || blankState();
  }catch{
    return blankState();
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}
function money(v){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
}
function parseMoney(v){
  return Number(String(v).replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,'')) || 0;
}
function isoToday(){
  return new Date().toISOString().slice(0,10);
}
function monthKey(dateStr){
  const d = new Date(dateStr+'T12:00:00');
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function currentMonthKey(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function formatDate(s){
  if(!s) return '';
  return new Date(s+'T12:00:00').toLocaleDateString('pt-BR');
}
function uid(){
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random());
}
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'),1800);
}

function seedData(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  state = {
    transactions:[
      {id:uid(),type:'income',description:'Salário',amount:7500,category:'Salário',date:`${y}-${m}-05`,dueDate:'',recurring:true},
      {id:uid(),type:'expense',description:'Supermercado',amount:620.40,category:'Alimentação',date:`${y}-${m}-08`,dueDate:'',recurring:false},
      {id:uid(),type:'expense',description:'Internet',amount:119.90,category:'Assinaturas',date:`${y}-${m}-10`,dueDate:`${y}-${m}-25`,recurring:true},
      {id:uid(),type:'expense',description:'Combustível',amount:280,category:'Transporte',date:`${y}-${m}-12`,dueDate:'',recurring:false},
      {id:uid(),type:'expense',description:'Academia',amount:129.90,category:'Saúde',date:`${y}-${m}-15`,dueDate:`${y}-${m}-28`,recurring:true}
    ],
    cards:[
      {id:uid(),name:'Cartão principal',limit:5000,closeDay:5,dueDay:12}
    ],
    budgets:{'Alimentação':1200,'Transporte':700,'Lazer':500,'Assinaturas':350}
  };
  saveState();
  toast('Dados de exemplo carregados');
}

function monthTransactions(){
  const mk = currentMonthKey();
  return state.transactions.filter(t=>monthKey(t.date)===mk);
}
function totals(){
  const all = state.transactions.reduce((a,t)=>{
    a[t.type]+=Number(t.amount); return a;
  },{income:0,expense:0});
  const month = monthTransactions().reduce((a,t)=>{
    a[t.type]+=Number(t.amount); return a;
  },{income:0,expense:0});
  return {all,month};
}

function renderHome(){
  const {all,month} = totals();
  document.getElementById('totalBalance').textContent = money(all.income-all.expense);
  document.getElementById('monthIncome').textContent = money(month.income);
  document.getElementById('monthExpense').textContent = money(month.expense);
  document.getElementById('monthLabel').textContent = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  const expenses = {};
  monthTransactions().filter(t=>t.type==='expense').forEach(t=>{
    expenses[t.category]=(expenses[t.category]||0)+Number(t.amount);
  });
  const entries = Object.entries(expenses).sort((a,b)=>b[1]-a[1]);
  const max = Math.max(...entries.map(x=>x[1]),1);
  document.getElementById('categoryBars').innerHTML = entries.length ? entries.slice(0,6).map(([cat,val])=>`
    <div class="bar-row">
      <div class="bar-meta"><span>${cat}</span><strong>${money(val)}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,(val/max)*100)}%"></div></div>
    </div>
  `).join('') : `<div class="empty">Nenhum gasto lançado neste mês.</div>`;

  const today = new Date(); today.setHours(0,0,0,0);
  const next = new Date(today); next.setDate(next.getDate()+30);
  const upcoming = state.transactions
    .filter(t=>t.type==='expense' && t.dueDate)
    .map(t=>({...t,d:new Date(t.dueDate+'T12:00:00')}))
    .filter(t=>t.d>=today && t.d<=next)
    .sort((a,b)=>a.d-b.d)
    .slice(0,5);
  document.getElementById('upcomingList').innerHTML = upcoming.length ? upcoming.map(t=>listItemHtml(t,true)).join('') :
    `<div class="empty">Nenhum vencimento nos próximos 30 dias.</div>`;
}

function listItemHtml(t, useDue=false){
  return `
    <div class="list-item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(t.description)}</div>
        <div class="item-sub">${escapeHtml(t.category)} · ${formatDate(useDue ? t.dueDate : t.date)}${t.recurring?' · recorrente':''}</div>
      </div>
      <div class="amount ${t.type}">${t.type==='expense'?'−':'+'}${money(t.amount)}</div>
    </div>`;
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}

function renderTransactions(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const type = document.getElementById('typeFilter').value;
  const rows = [...state.transactions]
    .filter(t=>type==='all'||t.type===type)
    .filter(t=>!q || `${t.description} ${t.category}`.toLowerCase().includes(q))
    .sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('transactionList').innerHTML = rows.length ? rows.map(t=>`
    <div class="list-item" data-id="${t.id}">
      <div class="item-main">
        <div class="item-title">${escapeHtml(t.description)}</div>
        <div class="item-sub">${escapeHtml(t.category)} · ${formatDate(t.date)}${t.recurring?' · recorrente':''}</div>
      </div>
      <div>
        <div class="amount ${t.type}">${t.type==='expense'?'−':'+'}${money(t.amount)}</div>
        <button class="icon-btn delete-tx" data-id="${t.id}" title="Excluir">🗑</button>
      </div>
    </div>
  `).join('') : `<div class="empty">Nenhum lançamento encontrado.</div>`;
  document.querySelectorAll('.delete-tx').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.transactions = state.transactions.filter(t=>t.id!==btn.dataset.id);
      saveState(); toast('Lançamento excluído');
    });
  });
}

function renderCards(){
  const monthExpenses = monthTransactions().filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);
  document.getElementById('cardsList').innerHTML = state.cards.length ? state.cards.map((c,i)=>{
    const used = i===0 ? monthExpenses : 0;
    const pct = Math.min(100, c.limit ? used/c.limit*100 : 0);
    return `
      <div class="card-box">
        <div class="card-top">
          <div>
            <div class="muted">Cartão</div>
            <strong>${escapeHtml(c.name)}</strong>
          </div>
          <button class="icon-btn delete-card" data-id="${c.id}">🗑</button>
        </div>
        <div class="card-limit">${money(used)} <span class="muted">/ ${money(c.limit)}</span></div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="item-sub" style="color:#cbd5e1;margin-top:10px">Fecha dia ${c.closeDay} · vence dia ${c.dueDay}</div>
      </div>`;
  }).join('') : `<div class="empty">Nenhum cartão cadastrado.</div>`;
  document.querySelectorAll('.delete-card').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.cards=state.cards.filter(c=>c.id!==btn.dataset.id);
      saveState(); toast('Cartão excluído');
    });
  });
}

function renderBudgets(){
  const spent = {};
  monthTransactions().filter(t=>t.type==='expense').forEach(t=>spent[t.category]=(spent[t.category]||0)+Number(t.amount));
  const entries = Object.entries(state.budgets);
  document.getElementById('budgetList').innerHTML = entries.length ? entries.map(([cat,limit])=>{
    const val=spent[cat]||0;
    const pct=Math.min(100,limit?val/limit*100:0);
    return `
      <div class="list-item">
        <div class="budget-line">
          <div class="budget-head"><strong>${cat}</strong><span>${money(val)} / ${money(limit)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('') : `<div class="empty">Nenhum orçamento definido.</div>`;
}

function renderAll(){
  renderHome();
  renderTransactions();
  renderCards();
  renderBudgets();
}

function fillCategories(){
  ['txCategory','budgetCategory'].forEach(id=>{
    document.getElementById(id).innerHTML = CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  });
}

function openDialog(kind){
  if(kind==='transaction'){
    document.getElementById('txDate').value = isoToday();
    document.getElementById('transactionDialog').showModal();
  }
  if(kind==='card') document.getElementById('cardDialog').showModal();
  if(kind==='budget') document.getElementById('budgetDialog').showModal();
}

document.addEventListener('click',e=>{
  const opener=e.target.closest('[data-open]');
  if(opener) openDialog(opener.dataset.open);
  if(e.target.closest('[data-close]')) e.target.closest('dialog').close();
  const nav=e.target.closest('[data-view]');
  if(nav){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById(`view-${nav.dataset.view}`).classList.add('active');
    document.querySelectorAll('.nav-btn[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===nav.dataset.view));
  }
});

document.getElementById('transactionForm').addEventListener('submit',e=>{
  e.preventDefault();
  const type = new FormData(e.currentTarget).get('txType');
  const tx={
    id:uid(), type,
    description:document.getElementById('txDescription').value.trim(),
    amount:parseMoney(document.getElementById('txAmount').value),
    category:document.getElementById('txCategory').value,
    date:document.getElementById('txDate').value,
    dueDate:document.getElementById('txDueDate').value,
    recurring:document.getElementById('txRecurring').checked
  };
  if(!tx.description || !tx.amount || !tx.date) return;
  state.transactions.push(tx);
  saveState();
  e.currentTarget.reset();
  document.getElementById('txDate').value=isoToday();
  document.getElementById('transactionDialog').close();
  toast('Lançamento salvo');
});

document.getElementById('cardForm').addEventListener('submit',e=>{
  e.preventDefault();
  state.cards.push({
    id:uid(),
    name:document.getElementById('cardName').value.trim(),
    limit:parseMoney(document.getElementById('cardLimit').value),
    closeDay:Number(document.getElementById('cardClose').value),
    dueDay:Number(document.getElementById('cardDue').value)
  });
  saveState(); e.currentTarget.reset(); document.getElementById('cardDialog').close(); toast('Cartão salvo');
});

document.getElementById('budgetForm').addEventListener('submit',e=>{
  e.preventDefault();
  const cat=document.getElementById('budgetCategory').value;
  state.budgets[cat]=parseMoney(document.getElementById('budgetAmount').value);
  saveState(); e.currentTarget.reset(); document.getElementById('budgetDialog').close(); toast('Orçamento salvo');
});

document.getElementById('searchInput').addEventListener('input',renderTransactions);
document.getElementById('typeFilter').addEventListener('change',renderTransactions);

document.getElementById('exportBtn').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`meu-financeiro-backup-${isoToday()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importInput').addEventListener('change',async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{
    const data=JSON.parse(await file.text());
    if(!data.transactions || !data.cards || !data.budgets) throw new Error('inválido');
    state=data; saveState(); toast('Backup importado');
  }catch{
    alert('Arquivo de backup inválido.');
  }
  e.target.value='';
});

document.getElementById('seedBtn').addEventListener('click',()=>{
  if(confirm('Substituir os dados atuais por dados de exemplo?')) seedData();
});

document.getElementById('clearBtn').addEventListener('click',()=>{
  if(confirm('Apagar todos os dados? Esta ação não pode ser desfeita.')){
    state=blankState(); saveState(); toast('Dados apagados');
  }
});

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); deferredPrompt=e;
  document.getElementById('installBtn').classList.remove('hidden');
});
document.getElementById('installBtn').addEventListener('click',async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  document.getElementById('installBtn').classList.add('hidden');
});

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'));
}

fillCategories();
document.getElementById('txDate').value=isoToday();
renderAll();
