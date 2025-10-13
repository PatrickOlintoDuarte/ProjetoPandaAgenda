/* ========= CONFIG GOOGLE ========= */
const CLIENT_ID   = "371129341051-8ukpj3l1chk4jccdhanm5mvu3h2ajnm0.apps.googleusercontent.com";
const CALENDAR_ID = "f115236e50fdb661333dfef8b424cfac22446bb8624c5f6ce3ddb1d666f3e102@group.calendar.google.com";

/* Somente Calendar agora (Sheets removido) */
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

/* ========= FIREBASE ========= */
let fbApp = null;
let fbDb  = null;
function initFirebase(){
  if (fbApp) return;
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) {
    console.warn("⚠️ Firebase sem config. Preencha window.FIREBASE_CONFIG no index.html");
    return;
  }
  fbApp = firebase.initializeApp(cfg);
  fbDb  = firebase.database();
}

/* ========= ESTADO ========= */
let isGoogleConnected = false;
let accessToken = null;
let selectedDate = new Date();
const vagasPorData = {};

/* ========= CAPACIDADES DEFAULT (fallback) ========= */
const DEFAULT_CAPACIDADE_BASE = {
  "Santo André":     { "Manutenção": 18, "Instalação": 10, "Implementação": 6, "Mudança de Endereço": 8, "Retenção": 7 },
  "Diadema":         { "Manutenção": 12, "Instalação": 6,  "Implementação": 4, "Mudança de Endereço": 6, "Retenção": 5 },
  "São Bernardo":    { "Manutenção": 20, "Instalação": 12, "Implementação": 6, "Mudança de Endereço": 8, "Retenção": 7 },
  "São Caetano":     { "Manutenção": 10, "Instalação": 5,  "Implementação": 3, "Mudança de Endereço": 4, "Retenção": 4 },
  "Ribeirão Pires":  { "Manutenção": 8,  "Instalação": 4,  "Implementação": 2, "Mudança de Endereço": 3, "Retenção": 3 },
  "Mauá":            { "Manutenção": 14, "Instalação": 7,  "Implementação": 4, "Mudança de Endereço": 5, "Retenção": 5 },
};

/* CAPACIDADES vigentes em memória (alteradas pela data) */
let CAPACIDADE_BASE = deepClone(DEFAULT_CAPACIDADE_BASE);

/* ========= OVERRIDES EXPANDIDOS ========= */
const CAPACIDADE_OVERRIDES = {}; // { "Cidade - Tarde": {Servico: numero, ...} }

/* ========= CIDADES ATIVAS / OCULTAS ========= */
const CIDADES_OCULTAS = new Set(["São Bernardo", "São Caetano", "Ribeirão Pires", "Mauá"]);
const isCityHiddenBase = (cidade) => CIDADES_OCULTAS.has(cidade);

/* ========= EXPANSÃO MANHÃ/TARDE ========= */
const CIDADES_COM_PERIODOS = new Set(["Santo André", "Diadema"]);
const SP_TZ = "America/Sao_Paulo";

/* ========= HELPERS ========= */
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
const $ = (id) => document.getElementById(id);
const on = (el, ev, cb) => { if (el) el.addEventListener(ev, cb); };

function toISODateSP(date){
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:SP_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;
}
function parseLocalDate(v){ const [y,m,d]=v.split('-').map(Number); return new Date(y,m-1,d); }
function formatPtSP(date){
  return new Intl.DateTimeFormat('pt-BR',{timeZone:SP_TZ,weekday:'long',year:'numeric',month:'long',day:'2-digit'}).format(date);
}
function setDatePickerTo(date){ const el=$('datePicker'); if(el) el.value = toISODateSP(date); }

/* ========= STATUS UI ========= */
function updateGoogleCalendarStatus(){
  const el = $("calendarStatus");
  if(!el) return;
  if(isGoogleConnected){
    el.className = "calendar-status connected";
    el.innerHTML = `<div class="status-icon">✅</div><div class="status-text"><div class="status-title">Google Calendar Conectado</div><div class="status-description">Usando capacidades + eventos reais</div></div>`;
  }else{
    el.className = "calendar-status disconnected";
    el.innerHTML = `<div class="status-icon">🔗</div><div class="status-text"><div class="status-title">Google Calendar</div><div class="status-description">Não conectado — mostrando todas as vagas disponíveis</div></div>`;
  }
}

/* ========= AUTH (GIS - popup p/ dev/local) ========= */
let tokenClient = null;
async function waitForGIS(timeoutMs=8000){
  return new Promise((resolve,reject)=>{
    const t0=Date.now();
    (function check(){
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      if (Date.now()-t0>timeoutMs) return reject(new Error("Timeout carregando Google Identity Services."));
      requestAnimationFrame(check);
    })();
  });
}
async function initGIS() {
  await waitForGIS();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    ux_mode: "popup",
    callback: async (resp) => {
      try{
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          isGoogleConnected = true;
          updateGoogleCalendarStatus();
          await buscarVagasData();
        } else {
          throw new Error("GIS: não retornou access_token.");
        }
      }catch(e){ showErrorBanner(e); }
    }
  });
}
async function handleAuthClick(){
  try{
    if (!tokenClient) await initGIS();
    tokenClient.requestAccessToken({ prompt: "consent" });
  }catch(e){ showErrorBanner(e); }
}

/* ========= GOOGLE CALENDAR ========= */
async function listEventsByDate(dateStringSP){
  if(!accessToken) {
    console.warn("⚠️ Sem token, não vou buscar eventos");
    return [];
  }
  const start = new Date(`${dateStringSP}T00:00:00-03:00`).toISOString();
  const end   = new Date(`${dateStringSP}T23:59:59-03:00`).toISOString();
  const url   = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events` +
                `?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}` +
                `&singleEvents=true&orderBy=startTime&maxResults=2500`;

  const controller = new AbortController();
  const timeoutId = setTimeout(()=>controller.abort(), 15000);

  try{
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if(!r.ok){
      const txt = await r.text().catch(()=>r.statusText);
      if (r.status === 401) {
        isGoogleConnected = false;
        updateGoogleCalendarStatus();
        throw new Error("Não autorizado (401). O token pode estar expirado. Clique em 'Conectar Google' novamente.");
      }
      if (r.status === 403) {
        throw new Error("Acesso negado (403). Habilite a Calendar API e autorize a origem no Google Cloud.");
      }
      throw new Error(`Calendar API falhou (${r.status}): ${txt}`);
    }

    const data = await r.json();
    return data.items || [];
  }catch(err){
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Tempo esgotado ao buscar eventos (timeout). Verifique sua conexão e tente novamente.");
    throw err;
  }
}

/* ========= FIREBASE (modular via window.__fb) =========
   Estrutura:
   /capacidades/{YYYY-MM-DD}/BASE/{Cidade}/{Servico} = numero
   /capacidades/{YYYY-MM-DD}/OVERRIDES/{Cidade - Tarde}/{Servico} = numero
*/
function fbPath(dateString){ return `capacidades/${dateString}`; }

async function fetchCapacidadesFromFirebase(dateString){
  if (!window.__fb || !window.__fb.db) {
    console.warn("Firebase não inicializado (ver <script type='module'> no index.html). Usando default local.");
    // reset para defaults
    CAPACIDADE_BASE = deepClone(DEFAULT_CAPACIDADE_BASE);
    Object.keys(CAPACIDADE_OVERRIDES).forEach(k=>delete CAPACIDADE_OVERRIDES[k]);
    CAPACIDADE = buildCapacidadeExpandida();
    return;
  }
  const { db, ref, get } = window.__fb;

  // reset base/overrides
  CAPACIDADE_BASE = deepClone(DEFAULT_CAPACIDADE_BASE);
  Object.keys(CAPACIDADE_OVERRIDES).forEach(k=>delete CAPACIDADE_OVERRIDES[k]);

  const snap = await get(ref(db, fbPath(dateString)));
  const data = snap.exists() ? snap.val() : null;

  if (data && data.BASE) {
    for (const cidade of Object.keys(data.BASE)) {
      CAPACIDADE_BASE[cidade] ??= {};
      for (const servico of Object.keys(data.BASE[cidade])) {
        CAPACIDADE_BASE[cidade][servico] = Number(data.BASE[cidade][servico] || 0);
      }
    }
  }
  if (data && data.OVERRIDES) {
    for (const key of Object.keys(data.OVERRIDES)) {
      CAPACIDADE_OVERRIDES[key] ??= {};
      for (const servico of Object.keys(data.OVERRIDES[key])) {
        CAPACIDADE_OVERRIDES[key][servico] = Number(data.OVERRIDES[key][servico] || 0);
      }
    }
  }

  CAPACIDADE = buildCapacidadeExpandida();
}

async function saveCapacidadesToFirebase(dateString){
  if (!window.__fb || !window.__fb.db) throw new Error("Firebase não inicializado (confira o bloco <script type='module'> no index.html).");
  const { db, ref, set } = window.__fb;

  const BASE = {};
  for (const cidade of Object.keys(CAPACIDADE_BASE)) {
    BASE[cidade] = {};
    for (const servico of Object.keys(CAPACIDADE_BASE[cidade])) {
      BASE[cidade][servico] = Number(CAPACIDADE_BASE[cidade][servico] || 0);
    }
  }

  const OVERRIDES = {};
  for (const key of Object.keys(CAPACIDADE_OVERRIDES)) {
    OVERRIDES[key] = {};
    for (const servico of Object.keys(CAPACIDADE_OVERRIDES[key])) {
      OVERRIDES[key][servico] = Number(CAPACIDADE_OVERRIDES[key][servico] || 0);
    }
  }

  await set(ref(db, fbPath(dateString)), { BASE, OVERRIDES, updatedAt: Date.now() });
}


/* ========= PARSING DE EVENTOS ========= */
const servicoIcons = { "Manutenção":"🔧", "Instalação":"📡", "Implementação":"⚙️", "Mudança de Endereço":"📦", "Retenção":"🤝" };
const SERVICE_KEYWORDS = [
  { service: "Manutenção", patterns: [/manuten[çc][aã]o/i, /preventiva/i, /\bt[eê]cnico\b/i] },
  { service: "Instalação", patterns: [/instala[çc][aã]o/i, /\binstalar\b/i, /\binstala[rd]\b/i] },
  { service: "Implementação", patterns: [/implementa[çc][aã]o/i, /\bimplanta[çc][aã]o\b/i, /\bimplementar\b/i] },
  { service: "Mudança de Endereço", patterns: [/mudan[çc]a\s+de\s+endere[çc]o/i, /mudan[çc]a.*endere[çc]o/i, /\btransfer[êe]ncia\s+de\s+end/i] },
  { service: "Retenção", patterns: [/reten[çc][aã]o/i, /cancelamento/i, /CANC(?:\s|.)*PONTO\s+ADC/i] },
];
function showErrorBanner(msg){
  console.error("❌ Erro:", msg);
  const box = document.getElementById("appErrors");
  const pre = document.getElementById("appErrorsText");
  if (box && pre) {
    pre.textContent = String(msg?.stack || msg);
    box.style.display = "block";
  }
}
window.onerror = (m, s, l, c, e)=>{ showErrorBanner(e?.stack || e || m); };
window.addEventListener('unhandledrejection', (ev)=>{ showErrorBanner(ev.reason?.stack || ev.reason); });

function extractCityFromDescription(desc=""){
  try{
    let m = desc.match(/^\s*Cidade:\s*(.+)\s*$/mi);
    if(m) return m[1].trim();
    m = desc.match(/Endere[çc]o completo:\s*(?:[A-Z]{2}\s+)?([A-Za-zÀ-ÿ\s]+?)(?:\s+\d{5}-\d{3}|\s+-|\s*,)/i);
    if(m) return m[1].trim();
    return null;
  }catch(e){ console.warn("extractCityFromDescription falhou:", e); return null; }
}
function detectServiceFromText(text=""){
  for (const e of SERVICE_KEYWORDS){ if (e.patterns.some(p => p.test(text))) return e.service; }
  return null;
}
function parseEventToSlot(ev){
  const title = `${ev?.summary||""} ${ev?.description||""}`.trim();
  const desc  = ev?.description || "";
  let servico = detectServiceFromText(title) || detectServiceFromText(desc);
  let cidade  = extractCityFromDescription(desc);
  if(cidade){
    const plain = cidade.normalize("NFD").replace(/\p{Diacritic}/gu,"");
    if(/Santo Andre/i.test(plain)) cidade = "Santo André";
    if(/Sao Bernardo/i.test(plain)) cidade = "São Bernardo";
    if(/Sao Caetano/i.test(plain))  cidade = "São Caetano";
  }
  return { cidade, servico };
}

/* ========= PERÍODO (MANHÃ/TARDE) ========= */
function getEventStartHourLocal(ev){
  const iso = ev?.start?.dateTime || (ev?.start?.date ? `${ev.start.date}T09:00:00` : null);
  if(!iso) return null;
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: SP_TZ }).formatToParts(d);
  const hourStr = parts.find(p=>p.type==='hour')?.value ?? "00";
  return parseInt(hourStr, 10);
}
function resolveCidadePeriodo(cidadeBase, ev){
  if (!cidadeBase) return null;
  if (CIDADES_COM_PERIODOS.has(cidadeBase)) {
    const h = getEventStartHourLocal(ev);
    const periodo = (h !== null && h >= 12) ? "Tarde" : "Manhã";
    return `${cidadeBase} - ${periodo}`;
  }
  return cidadeBase;
}

/* ========= RECÊNCIA (para excedentes: manter últimos) ========= */
function getEventCreationTs(ev){
  const created = ev?.created ? Date.parse(ev.created) : NaN;
  const startIso = ev?.start?.dateTime || (ev?.start?.date ? `${ev.start.date}T00:00:00` : null);
  const startTs = startIso ? Date.parse(startIso) : NaN;
  const updated = ev?.updated ? Date.parse(ev.updated) : NaN;
  if (!Number.isNaN(created)) return created;
  if (!Number.isNaN(updated)) return updated;
  if (!Number.isNaN(startTs)) return startTs;
  return 0;
}

/* ========= EXPANDIDO ========= */
function buildCapacidadeExpandida() {
  const expanded = {};
  for (const cidade of Object.keys(CAPACIDADE_BASE)) {
    if (isCityHiddenBase(cidade)) continue;

    const baseCaps = CAPACIDADE_BASE[cidade];
    if (CIDADES_COM_PERIODOS.has(cidade)) {
      const kManha = `${cidade} - Manhã`;
      const kTarde = `${cidade} - Tarde`;
      expanded[kManha] = { ...(CAPACIDADE_OVERRIDES[kManha] || baseCaps) };
      expanded[kTarde] = { ...(CAPACIDADE_OVERRIDES[kTarde] || baseCaps) };
    } else {
      expanded[cidade] = { ...(CAPACIDADE_OVERRIDES[cidade] || baseCaps) };
    }
  }
  return expanded;
}
let CAPACIDADE = buildCapacidadeExpandida();

/* ========= DIA / CAPACIDADES ========= */
function buildSkeletonWithCapacity(dateString){
  CAPACIDADE = buildCapacidadeExpandida();
  vagasPorData[dateString] = {};
  Object.keys(CAPACIDADE).forEach(cidade=>{
    vagasPorData[dateString][cidade] = {};
    Object.keys(CAPACIDADE[cidade]).forEach(serv=>{
      vagasPorData[dateString][cidade][serv] = { total: CAPACIDADE[cidade][serv], ocupadas: 0 };
    });
  });
}

/* ========= PREENCHE EVENTOS (mantém os últimos, descarte antigos) ========= */
async function preencherComEventos(dateString){
  buildSkeletonWithCapacity(dateString);
  const events = await listEventsByDate(dateString);

  const grupos = {}; // key -> [{title, ts}]
  for (const ev of events) {
    const { cidade: cidadeBase, servico } = parseEventToSlot(ev);
    if (!cidadeBase || !servico) continue;

    const cidade = resolveCidadePeriodo(cidadeBase, ev);
    const slot = vagasPorData[dateString]?.[cidade]?.[servico];
    if (!slot) continue;

    const k = `${cidade}||${servico}`;
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push({
      title: (ev?.summary || "(sem título)").trim(),
      ts: getEventCreationTs(ev)
    });
  }

  const excedentes = [];
  for (const k of Object.keys(grupos)) {
    const [cidade, servico] = k.split("||");
    const slot = vagasPorData[dateString][cidade][servico];
    const total = slot.total;

    const arr = grupos[k].sort((a,b)=> a.ts - b.ts);
    const mantidos = arr.slice(-total);
    const descartados = arr.slice(0, Math.max(0, arr.length - total));

    slot.ocupadas = Math.min(total, mantidos.length);
    for (const d of descartados) excedentes.push({ cidade, servico, title: d.title });
  }

  return excedentes;
}

/* ========= ESTATÍSTICAS / UI ========= */
function calcularEstatisticas(dateString){
  const dia = vagasPorData[dateString] || {};
  let total=0, ocupadas=0;
  Object.values(dia).forEach(services=>{
    Object.values(services).forEach(s=>{ total+=s.total; ocupadas+=s.ocupadas; });
  });
  const disponiveis = Math.max(0, total - ocupadas);
  const taxa = total ? Math.round((ocupadas/total)*100) : 0;
  const pDisp = total ? Math.round((disponiveis/total)*100) : 0;
  const pOcup = total ? Math.round((ocupadas/total)*100) : 0;
  return { total, ocupadas, disponiveis, taxa, pDisp, pOcup };
}
function animateNumber(el, finalValue, suffix="", duration=800){
  if(!el) return;
  const startValue = Number(el.textContent.replace(/\D/g,"")) || 0;
  const t0 = performance.now();
  function step(now){
    const k = Math.min((now-t0)/duration,1);
    el.textContent = Math.round(startValue + (finalValue-startValue)*k) + suffix;
    if(k<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function atualizarEstatisticasUI(dateString){
  const { total, ocupadas, disponiveis, taxa, pDisp, pOcup } = calcularEstatisticas(dateString);
  animateNumber($("totalVagas"), total);
  animateNumber($("vagasDisponiveis"), disponiveis);
  animateNumber($("vagasOcupadas"), ocupadas);
  animateNumber($("taxaOcupacao"), taxa, "%");
  const pd = $("percentualDisponivel"); if (pd) pd.innerHTML = `<span>📈</span><span>${pDisp}% do total</span>`;
  const po = $("percentualOcupado");   if (po) po.innerHTML = `<span>📊</span><span>${pOcup}% do total</span>`;
  const st = $("statusEficiencia");
  if (st){
    if (taxa <= 50){ st.className="stat-change positive"; st.innerHTML="<span>⚡</span><span>Ótima disponibilidade</span>"; }
    else if (taxa <= 80){ st.className="stat-change"; st.innerHTML="<span>⚖️</span><span>Ocupação moderada</span>"; }
    else { st.className="stat-change negative"; st.innerHTML="<span>🔥</span><span>Alta demanda</span>"; }
  }
}

/* ========= CIDADES / UI ========= */
function criarCardsCidadesUI(dateString){
  const cont = $("citiesGrid");
  if(!cont) return;
  cont.innerHTML = "";
  const dia = vagasPorData[dateString] || {};
  const cidades = Object.keys(dia);

  cidades.forEach((cidade, idx)=>{
    const data = dia[cidade];
    let totalCidade = 0, ocupCidade = 0;
    Object.values(data).forEach(s=>{ totalCidade+=s.total; ocupCidade+=s.ocupadas; });
    const dispCidade = Math.max(0, totalCidade - ocupCidade);

    const card = document.createElement("div");
    card.className = "city-card fade-in";
    card.style.animationDelay = `${idx*0.05}s`;
    card.innerHTML = `
      <div class="city-header">
        <div class="city-name">
          <span>🏙️ ${cidade}</span>
          <span class="city-total">${dispCidade}</span>
        </div>
      </div>
      <div class="city-content">
        <div class="services-grid">
          ${Object.keys(data).map(serv=>{
            const s = data[serv];
            const disp = Math.max(0, s.total - s.ocupadas);
            const perc = s.total ? Math.round((s.ocupadas/s.total)*100) : 0;
            const lotado = s.ocupadas >= s.total;
            return `
              <div class="service-item" data-lotado="${lotado}">
                <div class="service-info">
                  <div class="service-name">${servicoIcons[serv]||"🛠️"} ${serv}</div>
                  <div class="service-details">${s.ocupadas} agendadas de ${s.total} vagas</div>
                </div>
                <div class="service-availability">
                  <div class="available-count">${disp}</div>
                  <div class="total-count">disponíveis</div>
                  <div class="progress-container">
                    <div class="progress-bar" style="width:${perc}%"></div>
                  </div>
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>`;
    cont.appendChild(card);
  });
}

function atualizarSelecaoDataUI(d, msg=""){
  const isToday = toISODateSP(d)===toISODateSP(new Date());
  const dt = $("selectedDateText"); if (dt) dt.textContent = `📍 Data selecionada: ${isToday?"Hoje":formatPtSP(d)}`;
  const ds = $("dateStatus"); if (ds) ds.textContent = msg || `Exibindo disponibilidade para ${isToday?"hoje":"o dia selecionado"}.`;
}

/* ========= ALERTA DE EXCEDENTES ========= */
function notifyExcess(excedentes){
  if (!Array.isArray(excedentes) || excedentes.length === 0) return;

  const group = {};
  for (const e of excedentes) {
    const k = `${e.cidade}||${e.servico}`;
    if (!group[k]) group[k] = [];
    group[k].push(e.title);
  }

  const linhas = [];
  for (const key of Object.keys(group)) {
    const [cidade, servico] = key.split("||");
    const titulos = group[key].slice(0, 5).map(t => `- ${t}`).join("\n");
    const extra = group[key].length > 5 ? `\n  (+${group[key].length - 5} mais)` : "";
    linhas.push(`${cidade} • ${servico}\n${titulos}${extra}`);
  }

  alert(`⚠️ Capacidade excedida em alguns serviços:\n\n${linhas.join("\n\n")}`);

  const html = Object.keys(group).map(key => {
    const [cidade, servico] = key.split("||");
    const itens = group[key].map(t => `• ${t}`).join("<br>");
    return `<div style="margin-bottom:10px">
      <strong>${cidade}</strong> — <em>${servico}</em><br>${itens}
    </div>`;
  }).join("");

  const box = document.getElementById("appErrors");
  const pre = document.getElementById("appErrorsText");
  if (box && pre) {
    pre.innerHTML = html;
    box.style.display = "block";
  }
}

/* ========= FLUXOS ========= */
async function buscarVagasData(){
  try{
    const v = $("datePicker")?.value || toISODateSP(new Date());
    selectedDate = parseLocalDate(v);
    const ds = toISODateSP(selectedDate);

    // Carrega capacidade específica da DATA (Firebase)
    await fetchCapacidadesFromFirebase(ds);

    let excedentes = [];
    if(isGoogleConnected && accessToken){
      atualizarSelecaoDataUI(selectedDate,"Carregando eventos e calculando disponibilidade...");
      excedentes = await preencherComEventos(ds);
      atualizarSelecaoDataUI(selectedDate,"Eventos carregados com sucesso.");
    }else{
      buildSkeletonWithCapacity(ds);
      atualizarSelecaoDataUI(selectedDate,"Não conectado — mostrando todas as vagas disponíveis.");
    }

    atualizarEstatisticasUI(ds);
    criarCardsCidadesUI(ds);
    if (excedentes.length > 0) notifyExcess(excedentes);

  }catch(e){
    atualizarSelecaoDataUI(selectedDate, String(e.message || e));
    showErrorBanner(e);
    const ds = toISODateSP(selectedDate);
    buildSkeletonWithCapacity(ds);
    atualizarEstatisticasUI(ds);
    criarCardsCidadesUI(ds);
  }
}
function definirHoje(){ selectedDate=new Date(); setDatePickerTo(selectedDate); buscarVagasData(); }

/* ========= INIT ========= */
document.addEventListener("DOMContentLoaded", async ()=>{
  try{
    initFirebase();

    setDatePickerTo(selectedDate);
    updateGoogleCalendarStatus();
    await buscarVagasData();

    on($("buscarVagasBtn"), "click", buscarVagasData);
    on($("hojeBtn"), "click", definirHoje);
    on($("refreshBtn"), "click", async ()=>{
      const btn = $("refreshBtn");
      if (!btn) return;
      btn.disabled = true; btn.textContent = "🔄 Atualizando...";
      await buscarVagasData();
      btn.disabled = false; btn.textContent = "🔄 Atualizar";
    });
    on($("connectGoogleBtn"), "click", handleAuthClick);

    // Modal (defensivo)
    on($("reajustarBtn"), "click", openReajusteModal);
    on($("reajusteCancelar"), "click", fecharReajusteModal);
    on($("reajusteAplicar"), "click", aplicarReajusteSelecionado);
  }catch(e){ showErrorBanner(e); }
});

/* ========= REAJUSTE DE VAGAS (MODAL + SELECT) ========= */
function openReajusteModal(){
  const dlg = $("reajusteDialog");
  const select = $("reajusteCidadeSelect");
  const nota = $("reajusteNota");
  if (!dlg || !select || !nota) {
    console.warn("⚠️ Modal de reajuste não encontrado no DOM. Verifique o HTML.");
    return;
  }

  const capExp = buildCapacidadeExpandida();
  select.innerHTML = "";

  const optGlobal = document.createElement("option");
  optGlobal.value = "__GLOBAL__";
  optGlobal.textContent = "🌐 Global — todas as cidades ativas (desta data)";
  select.appendChild(optGlobal);

  Object.keys(capExp).sort().forEach(cidade=>{
    const opt = document.createElement("option");
    opt.value = cidade;
    opt.textContent = cidade;
    select.appendChild(opt);
  });

  nota.textContent = "As alterações serão salvas SOMENTE para a data atualmente selecionada.";
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open","");
}

function fecharReajusteModal(){
  const dlg = $("reajusteDialog");
  if (!dlg) return;
  if (dlg.open && typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
}

async function aplicarReajusteSelecionado(){
  const select = $("reajusteCidadeSelect");
  if (!select) {
    console.warn("⚠️ Select do modal não encontrado.");
    return;
  }
  try{
    const escolha = select.value;
    const servicos = ["Manutenção", "Instalação", "Implementação", "Mudança de Endereço", "Retenção"];

    const capExp = buildCapacidadeExpandida();

    if (escolha === "__GLOBAL__") {
      for (const cidade of Object.keys(capExp)) {
        for (const serv of servicos) {
          const atual = capExp[cidade][serv];
          const novo = parseInt(prompt(`(${toISODateSP(selectedDate)}) Nova capacidade para ${serv} em ${cidade} (atual: ${atual})`), 10);
          if (!isNaN(novo) && novo >= 0) capExp[cidade][serv] = novo;
        }
      }
      projectExpandedToStores(capExp);
      alert("✅ Vagas reajustadas globalmente (para a data atual).");
    } else if (capExp[escolha]) {
      for (const serv of servicos) {
        const atual = capExp[escolha][serv];
        const novo = parseInt(prompt(`(${toISODateSP(selectedDate)}) Nova capacidade para ${serv} em ${escolha} (atual: ${atual})`), 10);
        if (!isNaN(novo) && novo >= 0) capExp[escolha][serv] = novo;
      }
      projectExpandedToStores(capExp, escolha);
      alert(`✅ Vagas reajustadas para ${escolha} (data atual).`);
    } else {
      alert("❌ Cidade inválida.");
      return;
    }

    // >>> SALVA NO FIREBASE para a data selecionada
    await saveCapacidadesToFirebase(toISODateSP(selectedDate));

    fecharReajusteModal();
    buscarVagasData();
  } catch(e){ showErrorBanner(e); }
}

/* ========= PROJEÇÃO: EXPANDIDO → BASE/OVERRIDES ========= */
function projectExpandedToStores(capExpanded, onlyKey){
  const keys = onlyKey ? [onlyKey] : Object.keys(capExpanded);

  for (const key of keys) {
    const m = key.match(/^(.+)\s-\s(Manhã|Tarde)$/);
    if (m) {
      const baseName = m[1];
      const periodo = m[2];
      if (periodo === "Manhã") {
        CAPACIDADE_BASE[baseName] = { ...capExpanded[key] };
        delete CAPACIDADE_OVERRIDES[`${baseName} - Manhã`];
      } else {
        CAPACIDADE_OVERRIDES[`${baseName} - Tarde`] = { ...capExpanded[key] };
      }
    } else {
      CAPACIDADE_BASE[key] = { ...capExpanded[key] };
      delete CAPACIDADE_OVERRIDES[key];
    }
  }
}
