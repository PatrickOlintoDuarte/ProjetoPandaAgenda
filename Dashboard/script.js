/* ========= CONFIG GOOGLE ========= */
const CLIENT_ID   = "371129341051-8ukpj3l1chk4jccdhanm5mvu3h2ajnm0.apps.googleusercontent.com";
const CALENDAR_ID = "f115236e50fdb661333dfef8b424cfac22446bb8624c5f6ce3ddb1d666f3e102@group.calendar.google.com";
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

/* ========= ESTADO ========= */
let isGoogleConnected = false;
let accessToken = null;         // token do GIS
let selectedDate = new Date();
const vagasPorData = {};        // { 'YYYY-MM-DD': { Cidade: { Serviço: { total, ocupadas } } } }

/* ========= CAPACIDADES ========= */
/*  ⬇️ Ajustado para os 5 serviços genéricos */
const CAPACIDADE = {
  "Santo André":     { "Manutenção": 18, "Instalação": 10, "Implementação": 6, "Mudança de Endereço": 8, "Retenção": 7 },
  "Diadema":         { "Manutenção": 12, "Instalação": 6,  "Implementação": 4, "Mudança de Endereço": 6, "Retenção": 5 },
  "São Bernardo":    { "Manutenção": 20, "Instalação": 12, "Implementação": 6, "Mudança de Endereço": 8, "Retenção": 7 },
  "São Caetano":     { "Manutenção": 10, "Instalação": 5,  "Implementação": 3, "Mudança de Endereço": 4, "Retenção": 4 },
  "Ribeirão Pires":  { "Manutenção": 8,  "Instalação": 4,  "Implementação": 2, "Mudança de Endereço": 3, "Retenção": 3 },
  "Mauá":            { "Manutenção": 14, "Instalação": 7,  "Implementação": 4, "Mudança de Endereço": 5, "Retenção": 5 },
};

/* ========= SERVIÇOS / ÍCONES ========= */
/*  ⬇️ Ícones com os mesmos 5 nomes */
const servicoIcons = {
  "Manutenção": "🔧",
  "Instalação": "📡",
  "Implementação": "⚙️",
  "Mudança de Endereço": "📦",
  "Retenção": "🤝"
};

/* ========= PALAVRAS-CHAVE (regex) ========= */
/*  ⬇️ Classificação por título/descrição usando exatamente as 5 categorias */
const SERVICE_KEYWORDS = [
  {
    service: "Manutenção",
    patterns: [
      /manuten[çc][aã]o/i,          // manutenção / manutencao
      /preventiva/i,                // preventiva
      /\bt[eê]cnico\b/i             // técnico
    ]
  },
  {
    service: "Instalação",
    patterns: [
      /instala[çc][aã]o/i,          // instalação / instalacao
      /\binstalar\b/i,
      /\binstala[rd]\b/i            // instalar/instalad(o/a) (cobrir variações simples)
    ]
  },
  {
    service: "Implementação",
    patterns: [
      /implementa[çc][aã]o/i,       // implementação / implementacao
      /\bimplanta[çc][aã]o\b/i,     // implantação
      /\bimplementar\b/i
    ]
  },
  {
    service: "Mudança de Endereço",
    patterns: [
      /mudan[çc]a\s+de\s+endere[çc]o/i, // mudança de endereço
      /mudan[çc]a.*endere[çc]o/i,       // mudança ... endereço
      /\btransfer[êe]ncia\s+de\s+end/i  // transferência de end(ereço)
    ]
  },
  {
    service: "Retenção",
    patterns: [
      /reten[çc][aã]o/i,                // retenção / retencao
      /cancelamento/i,                  // cancelamento
      /CANC(?:\s|.)*PONTO\s+ADC/i       // CANC ... PONTO ADC (padrão já usado)
    ]
  },
];

/* ========= ERROS VISUAIS ========= */
function showErrorBanner(msg){
  console.error("❌ Erro:", msg);
  const box = document.getElementById("appErrors");
  const pre = document.getElementById("appErrorsText");
  pre.textContent = String(msg?.stack || msg);
  box.style.display = "block";
}
window.onerror = (m, s, l, c, e)=>{ showErrorBanner(e?.stack || m); };
window.addEventListener('unhandledrejection', (ev)=>{ showErrorBanner(ev.reason?.stack || ev.reason); });

/* ========= UTILS DATA (SP) ========= */
function toISODateSP(date){
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;
}
function parseLocalDate(v){ const [y,m,d]=v.split('-').map(Number); return new Date(y,m-1,d); }
function formatPtSP(date){
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',year:'numeric',month:'long',day:'2-digit'}).format(date);
}
function setDatePickerTo(date){ document.getElementById('datePicker').value = toISODateSP(date); }

/* ========= STATUS UI ========= */
function updateGoogleCalendarStatus(){
  const el = document.getElementById("calendarStatus");
  if(isGoogleConnected){
    el.className = "calendar-status connected";
    el.innerHTML = `<div class="status-icon">✅</div><div class="status-text"><div class="status-title">Google Calendar Conectado</div><div class="status-description">Usando capacidades + eventos reais</div></div>`;
  }else{
    el.className = "calendar-status disconnected";
    el.innerHTML = `<div class="status-icon">🔗</div><div class="status-text"><div class="status-title">Google Calendar</div><div class="status-description">Não conectado — mostrando todas as vagas disponíveis</div></div>`;
  }
}

/* ========= AUTH (GIS - redirect) ========= */
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
    ux_mode: "redirect",
    redirect_uri: window.location.origin + window.location.pathname,
    callback: (resp) => {
      console.log("🔑 GIS callback:", resp);
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        isGoogleConnected = true;
        updateGoogleCalendarStatus();
        buscarVagasData();
      } else {
        console.warn("⚠️ GIS não retornou access_token no callback");
      }
    }
  });
}

async function handleAuthClick(){
  try{
    if (!tokenClient) await initGIS();
    tokenClient.requestAccessToken({ prompt: "consent" });
  }catch(e){ showErrorBanner(e); }
}

/* ========= CALENDAR via fetch (com timeout) ========= */
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
  const timeoutId = setTimeout(()=>controller.abort(), 15000); // 15s
  console.log("🌐 Fetch eventos:", url);

  try{
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if(!r.ok){
      const txt = await r.text().catch(()=>r.statusText);
      console.error("❌ Calendar API ERRO:", r.status, txt);
      if (r.status === 401) {
        isGoogleConnected = false;
        updateGoogleCalendarStatus();
        throw new Error("Não autorizado (401). O token pode estar expirado. Clique em 'Conectar Google' novamente.");
      }
      if (r.status === 403) {
        throw new Error("Acesso negado (403). Habilite a Calendar API e autorize o redirect_uri no Google Cloud.");
      }
      throw new Error(`Calendar API falhou (${r.status}): ${txt}`);
    }

    const data = await r.json();
    console.log("📅 Eventos recebidos:", data.items?.length || 0);
    return data.items || [];
  }catch(err){
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Tempo esgotado ao buscar eventos (timeout). Verifique sua conexão e tente novamente.");
    }
    throw err;
  }
}

/* ========= PARSING ========= */
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
  for (const e of SERVICE_KEYWORDS){
    if (e.patterns.some(p => p.test(text))) return e.service;
  }
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

/* ========= DIA / CAPACIDADES ========= */
function buildSkeletonWithCapacity(dateString){
  vagasPorData[dateString] = {};
  Object.keys(CAPACIDADE).forEach(cidade=>{
    vagasPorData[dateString][cidade] = {};
    Object.keys(CAPACIDADE[cidade]).forEach(serv=>{
      vagasPorData[dateString][cidade][serv] = { total: CAPACIDADE[cidade][serv], ocupadas: 0 };
    });
  });
}
async function preencherComEventos(dateString){
  buildSkeletonWithCapacity(dateString);
  const events = await listEventsByDate(dateString);
  for(const ev of events){
    const { cidade, servico } = parseEventToSlot(ev);
    if(!cidade || !servico) continue;
    const slot = vagasPorData[dateString]?.[cidade]?.[servico];
    if(slot){ slot.ocupadas = Math.min(slot.total, slot.ocupadas + 1); }
  }
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
  animateNumber(document.getElementById("totalVagas"), total);
  animateNumber(document.getElementById("vagasDisponiveis"), disponiveis);
  animateNumber(document.getElementById("vagasOcupadas"), ocupadas);
  animateNumber(document.getElementById("taxaOcupacao"), taxa, "%");
  document.getElementById("percentualDisponivel").innerHTML = `<span>📈</span><span>${pDisp}% do total</span>`;
  document.getElementById("percentualOcupado").innerHTML   = `<span>📊</span><span>${pOcup}% do total</span>`;
  const st = document.getElementById("statusEficiencia");
  if (taxa <= 50){ st.className="stat-change positive"; st.innerHTML="<span>⚡</span><span>Ótima disponibilidade</span>"; }
  else if (taxa <= 80){ st.className="stat-change"; st.innerHTML="<span>⚖️</span><span>Ocupação moderada</span>"; }
  else { st.className="stat-change negative"; st.innerHTML="<span>🔥</span><span>Alta demanda</span>"; }
}

function criarCardsCidadesUI(dateString){
  const cont = document.getElementById("citiesGrid");
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
            return `
              <div class="service-item">
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
  document.getElementById("selectedDateText").textContent = `📍 Data selecionada: ${isToday?"Hoje":formatPtSP(d)}`;
  document.getElementById("dateStatus").textContent = msg || `Exibindo disponibilidade para ${isToday?"hoje":"o dia selecionado"}.`;
}

/* ========= FLUXOS ========= */
async function buscarVagasData(){
  try{
    const v = document.getElementById("datePicker").value || toISODateSP(new Date());
    selectedDate = parseLocalDate(v);
    const ds = toISODateSP(selectedDate);

    if(isGoogleConnected && accessToken){
      atualizarSelecaoDataUI(selectedDate,"Carregando eventos e calculando disponibilidade...");
      await preencherComEventos(ds);
      atualizarSelecaoDataUI(selectedDate,"Eventos carregados com sucesso.");
    }else{
      buildSkeletonWithCapacity(ds);
      atualizarSelecaoDataUI(selectedDate,"Não conectado — mostrando todas as vagas disponíveis.");
    }

    atualizarEstatisticasUI(ds);
    criarCardsCidadesUI(ds);
  }catch(e){
    console.error("⚠️ Erro em buscarVagasData:", e);
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
    // Se a página voltou do redirect com #access_token=..., captura
    const params = new URLSearchParams(window.location.hash.slice(1));
    const t = params.get("access_token");
    if (t) {
      console.log("🔑 Token via hash detectado.");
      accessToken = t;
      isGoogleConnected = true;
      updateGoogleCalendarStatus();
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    setDatePickerTo(selectedDate);
    updateGoogleCalendarStatus();
    await buscarVagasData();

    document.getElementById("buscarVagasBtn").addEventListener("click", buscarVagasData);
    document.getElementById("hojeBtn").addEventListener("click", definirHoje);
    document.getElementById("refreshBtn").addEventListener("click", async ()=>{
      const btn = document.getElementById("refreshBtn");
      btn.disabled = true; btn.textContent = "🔄 Atualizando...";
      await buscarVagasData();
      btn.disabled = false; btn.textContent = "🔄 Atualizar";
    });

    document.getElementById("connectGoogleBtn").addEventListener("click", handleAuthClick);
  }catch(e){ showErrorBanner(e); }
});
