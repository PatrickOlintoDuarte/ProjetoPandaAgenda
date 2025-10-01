/***** CONFIG *****/
/* Use seu Client ID do OAuth (Google Cloud Console > Credentials). */
const GOOGLE_CLIENT_ID = "371129341051-8ukpj3l1chk4jccdhanm5mvu3h2ajnm0.apps.googleusercontent.com";
/* leitura + escrita de eventos (drag/resize) */
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events";
const CALENDAR_ID = "primary";

/***** TÉCNICOS (edite aqui conforme sua equipe) *****/
/* colorId aceita valores de 1 a 11 (cores oficiais do Google Calendar).
   Sugestão de paleta:
   1:#4285f4  2:#0b8043  3:#9334e6  4:#e67c73  5:#f6c026  6:#f5511d
   7:#039be5  8:#616161  9:#3f51b5 10:#33b679 11:#d50000 */
const TECNICOS = [
  { name: "Técnico A", colorId: "10" },
  { name: "Técnico B", colorId: "9"  },
  { name: "Técnico C", colorId: "2"  }
];
// Se preferir manter um map direto: name -> colorId
const TECNICO_CORES = Object.fromEntries(TECNICOS.map(t => [t.name, t.colorId]));

/***** HELPERS/ESTADO *****/
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let accessToken = null;
let tokenClient = null;
let gapiInited = false;
let gisInited = false;

let currentView = "day";
let currentDate = new Date();
let calendarEvents = [];
let CURRENT_CAL_ID = CALENDAR_ID;

/* mapeamento de blocos do DIA (p/ relayout em tempo real) */
let dayBlocks = []; // [{ id, div }]

const calendarBody   = $("#calendarBody");
const calendarTitle  = $("#calendarTitle");
const prevPeriodBtn  = $("#prevPeriod");
const nextPeriodBtn  = $("#nextPeriod");
const authorizeBtn   = $("#authorize_button");
const signoutBtn     = $("#signout_button");
const calendarSelect = $("#calendarSelect");
const todayBtn       = $("#todayBtn");

/* timeline constants (Google-like density) */
const HOUR_PX  = 48;
const MIN_PX   = HOUR_PX / 60;
const SNAP_MIN = 15;
const COL_GAP  = 4;

/***** UI helpers *****/
function setStatus(msg){ if (calendarTitle) calendarTitle.textContent = msg; console.log("[status]", msg); }
function updateAuthUI(){
  if (!authorizeBtn || !signoutBtn) return;
  if (accessToken){ authorizeBtn.style.display="none"; signoutBtn.style.display="inline-block"; }
  else { authorizeBtn.style.display="inline-block"; signoutBtn.style.display="none"; }
}

/***** SANITY *****/
(function(){
  if (!GOOGLE_CLIENT_ID) setStatus("⚠️ Defina GOOGLE_CLIENT_ID no app.js");
  if (location.protocol === "file:") setStatus("⚠️ Rode com http://localhost — não use file://");
  if (location.protocol === "http:" && !["localhost","127.0.0.1"].includes(location.hostname)){
    setStatus("⚠️ Use HTTPS em produção (ou http://localhost em dev).");
  }
})();

/***** GOOGLE BOOTSTRAP *****/
window.gapiLoaded = async function(){
  try{
    await gapi.load("client", async ()=>{
      await gapi.client.init({ discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"] });
      gapiInited = true; setStatus("SDKs prontos. Conecte para ver eventos."); maybeEnableAuthBtn();
    });
  }catch(e){ console.error(e); setStatus("❌ Falha ao inicializar gapi."); }
};
window.gisLoaded = function(){
  try{
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
      callback: async (resp)=>{
        if (resp?.access_token){
          accessToken = resp.access_token;
          updateAuthUI();
          await loadCalendars();
          renderCalendar();
        } else {
          setStatus("❌ Não foi possível obter o token.");
        }
      }
    });
    gisInited = true; maybeEnableAuthBtn();
  }catch(e){ console.error(e); setStatus("❌ Falha ao inicializar GIS."); }
};
(function(){ if (window.gapi && !gapiInited) window.gapiLoaded(); if (window.google?.accounts?.oauth2 && !gisInited) window.gisLoaded(); })();
function maybeEnableAuthBtn(){
  if (!authorizeBtn) return;
  authorizeBtn.disabled = !(gapiInited && gisInited);
  if (!authorizeBtn.disabled) setStatus("Conecte para ver eventos");
}

/***** AUTENTICAÇÃO *****/
authorizeBtn?.addEventListener("click", ()=> tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" }));
signoutBtn?.addEventListener("click", ()=>{
  if (!accessToken) return;
  google.accounts.oauth2.revoke(accessToken, ()=>{
    accessToken=null; updateAuthUI(); renderCalendar(); setStatus("Desconectado.");
  });
});

/***** CALENDÁRIOS *****/
async function loadCalendars(){
  try{
    gapi.client.setToken({ access_token: accessToken });
    const {result:{items=[]}} = await gapi.client.calendar.calendarList.list({maxResults:250});
    if (calendarSelect){
      calendarSelect.innerHTML="";
      items.forEach(cal=>{
        const opt=document.createElement("option");
        opt.value=cal.id; opt.textContent=cal.summary+(cal.primary?" (primary)":"");
        if (cal.id===CURRENT_CAL_ID) opt.selected=true;
        calendarSelect.appendChild(opt);
      });
    }
    if (!items.find(c=>c.id===CURRENT_CAL_ID)) CURRENT_CAL_ID = items.find(c=>c.primary)?.id || CALENDAR_ID;
  }catch(e){ console.error("calendarList", e); }
}
calendarSelect?.addEventListener("change", ()=>{ CURRENT_CAL_ID = calendarSelect.value; renderCalendar(); });

/***** BUSCAR EVENTOS *****/
async function fetchCalendarEvents(startDate, endDate){
  if (!accessToken || !gapi?.client?.calendar?.events){
    calendarEvents=[]; if(!accessToken) setStatus("Conecte para ver eventos"); return;
  }
  try{
    gapi.client.setToken({ access_token: accessToken });
    const res = await gapi.client.calendar.events.list({
      calendarId: CURRENT_CAL_ID, timeMin: startDate.toISOString(), timeMax: endDate.toISOString(),
      singleEvents:true, orderBy:"startTime", maxResults:500
    });
    calendarEvents = res.result.items || [];
  }catch(e){ console.error("events.list", e); setStatus("❌ Erro ao buscar eventos."); calendarEvents=[]; }
}

/***** UTIL *****/
function minutesToLabel(min){ const h=Math.floor(min/60), m=min%60; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
function escapeHTML(s=""){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function linkify(html){ return html.replace(/(https?:\/\/[^\s<]+)/g, m=>`<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`); }
function fmtRange(start, end, allDay){
  if (allDay){ return new Date(start).toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }
  const s=new Date(start), e=new Date(end), same=s.toDateString()===e.toDateString();
  const d={weekday:"long",day:"numeric",month:"long",year:"numeric"}, t={hour:"2-digit",minute:"2-digit"};
  return same ? `${s.toLocaleDateString("pt-BR",d)} • ${s.toLocaleTimeString("pt-BR",t)}–${e.toLocaleTimeString("pt-BR",t)}`
              : `${s.toLocaleString("pt-BR",{...d,...t})} – ${e.toLocaleString("pt-BR",{...d,...t})}`;
}

/***** RANGE DO PERÍODO ATUAL *****/
function getCurrentRange(){
  if (currentView === "day"){
    const start = new Date(currentDate); start.setHours(0,0,0,0);
    const end   = new Date(currentDate); end.setHours(23,59,59,999);
    return { start, end };
  }
  if (currentView === "week"){
    const start = new Date(currentDate); start.setDate(start.getDate() - start.getDay()); start.setHours(0,0,0,0);
    const end   = new Date(start); end.setDate(end.getDate()+6); end.setHours(23,59,59,999);
    return { start, end };
  }
  // month
  const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const last  = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0);
  const start = new Date(first); start.setDate(start.getDate()-first.getDay()); start.setHours(0,0,0,0);
  const end   = new Date(last);  end.setDate(end.getDate()+(6-last.getDay())); end.setHours(23,59,59,999);
  return { start, end };
}

/***** REFRESH SUAVE (reconsulta + preserva scroll) *****/
let refreshLock = false;
async function refreshCurrentView(){
  if (refreshLock) return;
  refreshLock = true;

  const scroller = $(".timeline-scroller");
  const rememberScroll = scroller ? scroller.scrollTop : null;

  const { start, end } = getCurrentRange();
  await fetchCalendarEvents(start, end);
  await renderCalendar(); // re-render do período atual

  if (rememberScroll != null){
    const newScroller = $(".timeline-scroller");
    if (newScroller) newScroller.scrollTop = rememberScroll;
  }
  refreshLock = false;
}

/***** SALVAR (drag/resize) — sem re-render geral, com refresh suave *****/
async function saveEventTimes(event, newStart, newEnd){
  try{
    gapi.client.setToken({ access_token: accessToken });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await gapi.client.calendar.events.patch({
      calendarId: CURRENT_CAL_ID, eventId: event.id,
      resource:{ start:{dateTime:newStart.toISOString(), timeZone:tz}, end:{dateTime:newEnd.toISOString(), timeZone:tz} }
    });

    // Atualiza o evento localmente (imediato)
    const idx = calendarEvents.findIndex(e => e.id === event.id);
    if (idx > -1) {
      calendarEvents[idx] = {
        ...calendarEvents[idx],
        start: { dateTime: newStart.toISOString() },
        end:   { dateTime: newEnd.toISOString() }
      };
    }

    setStatus("Evento atualizado");
    await refreshCurrentView();
  }catch(e){
    console.error("events.patch", e);
    alert("Falha ao salvar. Verifique permissões de edição.");
  }
}

/***** Util: técnico no título *****/
function detectTechnicianInSummary(summary=""){
  const s = summary.trim();
  for (const t of TECNICOS){
    const p = `${t.name} - `;
    if (s.startsWith(p)) return t.name;
  }
  return null;
}
function stripTechnicianPrefix(summary=""){
  for (const t of TECNICOS){
    const p = `${t.name} - `;
    if (summary.startsWith(p)) return summary.slice(p.length);
  }
  return summary;
}

/***** Vincular técnico: aplica cor + prefixa título + salva *****/
async function assignTechnicianToEvent(eventId, tecnicoName){
  try{
    gapi.client.setToken({ access_token: accessToken });
    const { result: ev } = await gapi.client.calendar.events.get({ calendarId: CURRENT_CAL_ID, eventId });

    const baseSummary = stripTechnicianPrefix(ev.summary || "Sem título");
    const newSummary  = `${tecnicoName} - ${baseSummary}`.trim();
    const colorId     = TECNICO_CORES[tecnicoName] || ev.colorId || "10";

    await gapi.client.calendar.events.patch({
      calendarId: CURRENT_CAL_ID,
      eventId,
      resource: {
        summary: newSummary,
        colorId,
        // dica: podemos gravar o nome também em propriedades privadas
        extendedProperties: {
          private: { tecnico: tecnicoName }
        }
      }
    });

    // Atualiza local e refresca UI
    const idx = calendarEvents.findIndex(e => e.id === eventId);
    if (idx > -1){
      calendarEvents[idx] = {
        ...calendarEvents[idx],
        summary: newSummary,
        colorId
      };
    }
    setStatus(`Vinculado a ${tecnicoName}`);
    await refreshCurrentView();
  }catch(e){
    console.error("assignTechnicianToEvent", e);
    alert("Não consegui vincular o técnico. Verifique permissões.");
  }
}

/***** DETALHES (um clique) + seletor de técnico *****/
async function showEventModal(eventOrId){
  const eventId = typeof eventOrId==="string" ? eventOrId : eventOrId.id;
  const modal=$("#appointmentModal"), modalContent=$("#modalContent");
  if (!modal || !modalContent) return;
  modal.style.display="flex"; modalContent.innerHTML=`<div style="padding:16px">Carregando…</div>`;
  try{
    gapi.client.setToken({ access_token: accessToken });
    const {result:ev} = await gapi.client.calendar.events.get({ calendarId: CURRENT_CAL_ID, eventId, conferenceDataVersion:1 });
    const allDay = !!ev.start.date;
    const range = fmtRange(ev.start.dateTime||ev.start.date, ev.end?.dateTime||ev.end?.date, allDay);
    const desc = ev.description ? linkify(escapeHTML(ev.description)).replace(/\n/g,"<br>") : "";
    const attendees = (ev.attendees||[]).map(a=>{
      const label = ({accepted:"Aceito", declined:"Recusado", tentative:"Talvez", needsAction:"Sem resposta"})[a.responseStatus||"needsAction"] || "";
      return `<li style="margin:2px 0">${escapeHTML(a.displayName||a.email)} <small style="color:#9aa0a6">• ${label}</small></li>`;
    }).join("");
    const htmlLink = ev.htmlLink ? `<a href="${ev.htmlLink}" target="_blank" rel="noopener">Abrir no Google Agenda</a>` : "";
    const meet = ev.conferenceData?.entryPoints?.find(p=>p.entryPointType==="video")?.uri || ev.hangoutLink;
    const meetHtml = meet ? `<p><strong>🎥 Reunião:</strong> <a href="${meet}" target="_blank" rel="noopener">${meet}</a></p>` : "";
    const attachments = (ev.attachments||[]).map(a=>`<li><a href="${a.fileUrl}" target="_blank" rel="noopener">${escapeHTML(a.title||a.fileUrl)}</a></li>`).join("");

    const currentTec = ev.extendedProperties?.private?.tecnico
                    || detectTechnicianInSummary(ev.summary || "") || "";

    const techOptions = TECNICOS.map(t=>{
      const sel = t.name===currentTec ? "selected" : "";
      return `<option value="${escapeHTML(t.name)}" ${sel}>${escapeHTML(t.name)}</option>`;
    }).join("");

    $("#modalContent").innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div style="font-weight:700">${escapeHTML(ev.summary||"Sem título")}</div>
          <button id="modalCloseBtn2" class="modal-close">✕</button>
        </div>
        <div class="modal-content">
          <div class="tech-row" style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
            <button class="btn" id="linkTechBtn" title="Vincular técnico">Vincular técnico</button>
            <select id="techSelect" class="tech-select" style="padding:8px 10px; border-radius:10px; background:#0f141a; border:1px solid #2a2f37; color:#e8eaed;">
              <option disabled ${currentTec ? "" : "selected"} value="">Escolha o técnico…</option>
              ${techOptions}
            </select>
            ${currentTec ? `<span style="color:#9aa0a6; font-size:12px">Atual: ${escapeHTML(currentTec)}</span>` : ""}
          </div>

          <p><strong>🕒</strong> ${range}</p>
          ${ev.location?`<p><strong>📍</strong> ${escapeHTML(ev.location)}</p>`:""}
          ${htmlLink?`<p>${htmlLink}</p>`:""}
          ${meetHtml}
          ${desc?`<p><strong>📝 Detalhes:</strong><br>${desc}</p>`:""}
          ${attendees?`<div style="margin-top:10px"><strong>👥 Participantes</strong><ul style="margin:6px 0 0 18px">${attendees}</ul></div>`:""}
          ${attachments?`<div style="margin-top:10px"><strong>📎 Anexos</strong><ul style="margin:6px 0 0 18px">${attachments}</ul></div>`:""}
        </div>
      </div>
    `;

    // Fecha modal
    $("#modalCloseBtn2")?.addEventListener("click", ()=> $("#appointmentModal").style.display="none");

    // Ao clicar no botão, foca o select (efeito de "botão que abre a escolha")
    $("#linkTechBtn")?.addEventListener("click", ()=> $("#techSelect")?.focus());

    // Aplica automaticamente ao trocar o técnico
    $("#techSelect")?.addEventListener("change", async (e)=>{
      const name = e.target.value;
      if (!name) return;
      await assignTechnicianToEvent(eventId, name);
      $("#appointmentModal").style.display="none";
    });

  }catch(e){
    console.error("events.get", e);
    modalContent.innerHTML=`<div style="padding:16px">Não consegui carregar o evento.</div>`;
  }
}
$("#modalCloseBtn")?.addEventListener("click", ()=> $("#appointmentModal").style.display="none");

/***** LAYOUT DE COLISÃO (colunas) *****/
function layoutColumns(timed){
  timed.sort((a,b)=>a.startMin-b.startMin);
  const clusters=[]; let cur=[], end=-1;
  for (const ev of timed){
    if (!cur.length){ cur=[ev]; end=ev.endMin; continue; }
    if (ev.startMin < end){ cur.push(ev); end=Math.max(end, ev.endMin); }
    else { clusters.push(cur); cur=[ev]; end=ev.endMin; }
  }
  if (cur.length) clusters.push(cur);
  const out=[];
  for (const cluster of clusters){
    const cols=[]; // fim de cada coluna
    for (const ev of cluster){
      let col=0; for(; col<cols.length; col++){ if (ev.startMin>=cols[col]) break; }
      if (col===cols.length) cols.push(ev.endMin); else cols[col]=ev.endMin;
      out.push({ev, col, cols: cols.length});
    }
  }
  return out;
}

/***** Relayout ao vivo durante drag/resize (DIA) *****/
function liveRelayoutFromDOM(){
  const list = dayBlocks.map(b=>{
    const top = parseFloat(b.div.style.top) || 0;
    const h   = parseFloat(b.div.style.height) || 0;
    return { event:{id:b.id}, startMin: Math.round(top / MIN_PX), endMin: Math.round((top + h) / MIN_PX) };
  }).filter(x=>x.endMin>x.startMin);

  const positioned = layoutColumns(list.map(t=>({...t})));
  const byId = {}; positioned.forEach(p=> { byId[p.ev.event.id] = p; });

  for (const b of dayBlocks){
    const p = byId[b.id];
    if (!p) continue;
    const widthPct=100/p.cols, leftPct=widthPct*p.col;
    b.div.style.left  = `calc(${leftPct}% + ${COL_GAP}px)`;
    b.div.style.width = `calc(${widthPct}% - ${COL_GAP}px)`;
  }
}

/***** CHIP “DIA TODO” (cores oficiais + Material) *****/
function renderAllDayChip(ev){
  const chip=document.createElement("div");
  chip.className="appointment-item";
  chip.textContent = ev.summary || "Sem título";
  chip.title = chip.textContent;
  chip.addEventListener("click", ()=> showEventModal(ev.id));

  // Cores oficiais Google Calendar
  const chipColors = {
    "1":"#4285f4","2":"#0b8043","3":"#9334e6","4":"#e67c73","5":"#f6c026","6":"#f5511d",
    "7":"#039be5","8":"#616161","9":"#3f51b5","10":"#33b679","11":"#d50000"
  };
  const colorId = ev.colorId && chipColors[ev.colorId] ? ev.colorId : null;
  if (colorId){
    const bg = chipColors[colorId];
    chip.style.background = bg;
    chip.style.color = "#fff";
    chip.style.border = "none";
    chip.style.boxShadow = "var(--shadow-sm)";
  }
  return chip;
}

/***** BLOCO CRONOMETRADO — drag fluido + colisão ao vivo *****/
function renderTimedBlock(event, leftPct, widthPct, topPx, heightPx, scroller, grid) {
  const colorMap = {
    "1": { bg: "#a4bdfc", border: "#4285f4" }, "2": { bg: "#7ae7bf", border: "#0b8043" },
    "3": { bg: "#dbadff", border: "#9334e6" }, "4": { bg: "#ff887c", border: "#e67c73" },
    "5": { bg: "#fbd75b", border: "#f6c026" }, "6": { bg: "#ffb878", border: "#f5511d" },
    "7": { bg: "#46d6db", border: "#039be5" }, "8": { bg: "#e1e1e1", border: "#616161" },
    "9": { bg: "#5484ed", border: "#3f51b5" }, "10": { bg: "#51b749", border: "#33b679" },
    "11": { bg: "#dc2127", border: "#d50000" }
  };
  const colors = event.colorId && colorMap[event.colorId] ? colorMap[event.colorId] : { bg: "#e8eaed", border:"#9aa0a6" };

  const div = document.createElement("div");
  div.className = "event-block";
  div.dataset.eventId = event.id;
  div.style.setProperty("--tech-color", colors.bg);
  div.style.background = colors.bg;
  div.style.borderLeftColor = colors.border;
  div.style.left   = `calc(${leftPct}% + ${COL_GAP}px)`;
  div.style.width  = `calc(${widthPct}% - ${COL_GAP}px)`;
  div.style.top    = `${topPx}px`;
  div.style.height = `${Math.max(heightPx, 22)}px`;

  const titleEl = document.createElement("div");
  titleEl.className = "event-title";
  titleEl.textContent = event.summary || "Sem título";
  div.title = titleEl.textContent;
  div.appendChild(titleEl);

  const handle = document.createElement("div");
  handle.className = "event-resize";
  div.appendChild(handle);

  // etiqueta dinâmica (horário) durante drag
  const indicator = document.createElement("div");
  Object.assign(indicator.style, {
    position: "absolute",
    zIndex: 200,
    color: "#fff",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: "600",
    background: "rgba(60,64,67,.9)",
    boxShadow: "0 2px 4px rgba(0,0,0,.4)",
    display: "none",
    pointerEvents: "none"
  });
  grid.appendChild(indicator);

  const pointerToGridY = (clientY) => {
    const rect = grid.getBoundingClientRect();
    return (clientY - rect.top) + scroller.scrollTop;
  };
  const minutesLabel = (px) => {
    const min = Math.round(px / MIN_PX);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const clampTop = (rawTop, heightNow) => {
    const maxTop = (24 * 60) * MIN_PX - heightNow;
    return Math.min(Math.max(rawTop, 0), maxTop);
  };
  const updateIndicator = () => {
    const topNow = parseFloat(div.style.top);
    const hNow   = parseFloat(div.style.height);
    indicator.textContent = `${minutesLabel(topNow)}–${minutesLabel(topNow + hNow)}`;
    indicator.style.left  = div.style.left;
    indicator.style.top   = `${Math.max(0, topNow - 26)}px`;
  };

  const DRAG_THRESHOLD = 4;
  let mode = "idle";
  let startY = 0;
  let moved  = 0;
  let grabOffsetInGrid = 0;

  let raf = null;
  let pendingY = null;
  const schedule = (cb) => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; cb(); }); };

  const lockDoc = () => { document.body.classList.add("dragging-doc"); scroller.classList.add("lock-scroll"); };
  const unlockDoc = () => { document.body.classList.remove("dragging-doc"); scroller.classList.remove("lock-scroll"); };

  const startDrag = (clientY) => {
    const gridY = pointerToGridY(clientY);
    const blockTop = parseFloat(div.style.top);
    grabOffsetInGrid = gridY - blockTop;
    mode = "drag";
    lockDoc();
    indicator.style.display = "block";
    div.classList.add("dragging");
    updateIndicator();
  };

  const startResize = () => {
    mode = "resize";
    lockDoc();
    indicator.style.display = "block";
    div.classList.add("dragging");
    updateIndicator();
  };

  const markCollisions = () => {
    const top = parseFloat(div.style.top);
    const bottom = top + parseFloat(div.style.height);
    let collides = false;

    for (const b of dayBlocks){
      if (b.div === div) continue;
      const t2 = parseFloat(b.div.style.top);
      const b2 = t2 + parseFloat(b.div.style.height);
      const overlap = Math.max(top, t2) < Math.min(bottom, b2);
      if (overlap){
        collides = true;
        b.div.classList.add("collision-peer");
      } else {
        b.div.classList.remove("collision-peer");
      }
    }

    if (collides){
      div.classList.add("collision");
      indicator.style.background = "rgba(234,67,53,.92)";
    } else {
      div.classList.remove("collision");
      dayBlocks.forEach(b=> b.div.classList.remove("collision-peer"));
      indicator.style.background = "rgba(60,64,67,.9)";
    }
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const isResizeHandle = e.target === handle;

    mode = "idle";
    moved = 0;
    startY = e.clientY;

    div.setPointerCapture(e.pointerId);

    if (isResizeHandle) {
      startResize();
    } else {
      startDrag(e.clientY);
    }
  };

  const onPointerMove = (e) => {
    if (!div.hasPointerCapture?.(e.pointerId)) return;
    moved += Math.abs(e.clientY - startY);
    pendingY = e.clientY;

    schedule(() => {
      if (pendingY == null) return;
      const gridY = pointerToGridY(pendingY);

      if (mode === "drag") {
        if (moved < DRAG_THRESHOLD) return;
        const targetTop = clampTop(gridY - grabOffsetInGrid, parseFloat(div.style.height));
        div.style.top = `${targetTop}px`;
        updateIndicator();
        markCollisions();
        liveRelayoutFromDOM();
      } else if (mode === "resize") {
        const baseTop = parseFloat(div.style.top);
        let targetH = gridY - baseTop;
        const minH = MIN_PX * SNAP_MIN;
        const maxH = (24 * 60) * MIN_PX - baseTop;
        const bounded = Math.min(Math.max(targetH, minH), maxH);
        div.style.height = `${bounded}px`;
        updateIndicator();
        markCollisions();
        liveRelayoutFromDOM();
      }
      pendingY = null;
    });

    e.preventDefault?.();
  };

  const onPointerUp = async (e) => {
    try { div.releasePointerCapture(e.pointerId); } catch {}
    indicator.style.display = "none";
    indicator.remove();
    div.classList.remove("dragging");
    dayBlocks.forEach(b=> b.div.classList.remove("collision-peer"));
    unlockDoc();

    if (moved <= DRAG_THRESHOLD || mode === "idle") {
      mode = "idle";
      showEventModal(event.id);
      return;
    }

    const visualTop = parseFloat(div.style.top);
    const visualH   = parseFloat(div.style.height);
    const snapPx = SNAP_MIN * MIN_PX;

    const snappedTop = Math.round(visualTop / snapPx) * snapPx;
    const snappedH   = Math.max(snapPx, Math.round(visualH / snapPx) * snapPx);

    div.style.top = `${snappedTop}px`;
    div.style.height = `${snappedH}px`;

    liveRelayoutFromDOM();

    const startMin = Math.round(snappedTop / MIN_PX);
    const durMin   = Math.round(snappedH / MIN_PX);

    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const d = currentDate.getDate();

    const newStart = new Date(y, m, d, Math.floor(startMin / 60), startMin % 60, 0, 0);
    const newEnd   = new Date(y, m, d, Math.floor((startMin + durMin) / 60), (startMin + durMin) % 60, 0, 0);

    await saveEventTimes(event, newStart, newEnd);
    mode = "idle";
  };

  div.addEventListener("pointerdown", onPointerDown);
  div.addEventListener("pointermove", onPointerMove);
  div.addEventListener("pointerup", onPointerUp);
  div.addEventListener("pointercancel", onPointerUp);

  div.addEventListener("click", () => { if (mode === "idle") showEventModal(event.id); });

  return div;
}

/***** VIEW: DIA *****/
async function renderDayView(){
  const dateStr = currentDate.toLocaleDateString("pt-BR",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  calendarTitle.textContent = dateStr.charAt(0).toUpperCase()+dateStr.slice(1);

  const startOfDay=new Date(currentDate); startOfDay.setHours(0,0,0,0);
  const endOfDay=new Date(currentDate);   endOfDay.setHours(23,59,59,999);
  await fetchCalendarEvents(startOfDay, endOfDay);

  const container=document.createElement("div"); container.className="timeline-day";

  const allDay = calendarEvents.filter(e=>!!e.start.date);
  const alldayRow=document.createElement("div"); alldayRow.className="allday-row";
  alldayRow.innerHTML=`<div class="allday-label">Dia todo</div><div class="allday-events"></div>`;
  const alldayBox=alldayRow.querySelector(".allday-events");
  if (allDay.length) allDay.forEach(ev=> alldayBox.appendChild(renderAllDayChip(ev)));
  else alldayBox.appendChild(Object.assign(document.createElement("div"),{className:"appointment-item",textContent:"—",style:"opacity:.6"}));
  container.appendChild(alldayRow);

  const scroller=document.createElement("div"); scroller.className="timeline-scroller";
  const wrap=document.createElement("div"); wrap.className="timeline-wrap";
  const hours=document.createElement("div"); hours.className="timeline-hours";
  for(let h=0;h<24;h++){
    const el=document.createElement("div"); el.className="timeline-hour"; el.innerHTML=`<span>${String(h).padStart(2,"0")}:00</span>`; el.style.height=`${HOUR_PX}px`;
    hours.appendChild(el);
  }
  const grid=document.createElement("div"); grid.className="timeline-grid"; grid.style.height=`${24*HOUR_PX}px`;

  const today=new Date(); if (today.toDateString()===currentDate.toDateString()){
    const nowMin=today.getHours()*60+today.getMinutes();
    const now=document.createElement("div"); now.className="now-line"; now.style.top=`${nowMin*MIN_PX}px`; grid.appendChild(now);
    setTimeout(()=>{ scroller.scrollTop=Math.max(0, nowMin*MIN_PX - 200); }, 0);
  }

  const timed = calendarEvents.filter(e=>!!e.start.dateTime).map(e=>{
    const s=new Date(e.start.dateTime), e2=new Date(e.end.dateTime);
    const startMin=Math.max(0, s.getHours()*60 + s.getMinutes());
    const endMin=Math.min(24*60, e2.getHours()*60 + e2.getMinutes());
    return {event:e, startMin, endMin};
  }).filter(x=>x.endMin>x.startMin);

  dayBlocks = [];

  const positioned = layoutColumns(timed.map(t=>({...t})));
  for (const p of positioned){
    const widthPct=100/p.cols, leftPct=widthPct*p.col;
    const topPx=p.ev.startMin*MIN_PX, heightPx=(p.ev.endMin-p.ev.startMin)*MIN_PX;
    const div = renderTimedBlock(p.ev.event, leftPct, widthPct, topPx, heightPx, scroller, grid);
    grid.appendChild(div);
    dayBlocks.push({ id: p.ev.event.id, div });
  }

  wrap.appendChild(hours); wrap.appendChild(grid);
  scroller.appendChild(wrap);
  container.appendChild(scroller);

  calendarBody.innerHTML=""; calendarBody.appendChild(container);
}

/***** VIEW: SEMANA *****/
async function renderWeekView(){
  const startOfWeek=new Date(currentDate); startOfWeek.setDate(startOfWeek.getDate()-startOfWeek.getDay()); startOfWeek.setHours(0,0,0,0);
  const endOfWeek=new Date(startOfWeek); endOfWeek.setDate(endOfWeek.getDate()+6); endOfWeek.setHours(23,59,59,999);
  calendarTitle.textContent=`Semana: ${startOfWeek.toLocaleDateString("pt-BR")} - ${endOfWeek.toLocaleDateString("pt-BR")}`;

  await fetchCalendarEvents(startOfWeek, endOfWeek);

  const container=document.createElement("div"); container.className="week-view";
  const header=document.createElement("div"); header.className="week-header"; header.innerHTML='<div class="week-day-header"></div>';
  ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].forEach((d,i)=>{
    const dayDate=new Date(startOfWeek); dayDate.setDate(dayDate.getDate()+i);
    const cell=document.createElement("div"); cell.className="week-day-header";
    if (dayDate.toDateString()===new Date().toDateString()) cell.classList.add("today");
    cell.innerHTML=`${d}<br>${dayDate.getDate()}`; header.appendChild(cell);
  });
  container.appendChild(header);

  const grid=document.createElement("div"); grid.className="week-grid";
  const timed=Array(7).fill(null).map(()=>({})), allday=Array(7).fill(null).map(()=>[]);
  calendarEvents.forEach(ev=>{
    const isAllDay=!!ev.start.date;
    const start=new Date(ev.start.dateTime||ev.start.date);
    const idx=Math.floor((start-startOfWeek)/86400000); if(idx<0||idx>6) return;
    if (isAllDay) allday[idx].push(ev); else { const h=start.getHours(); (timed[idx][h] ||= []).push(ev); }
  });

  grid.appendChild(Object.assign(document.createElement("div"),{className:"week-hour-label",textContent:"Dia todo"}));
  for(let d=0;d<7;d++){
    const c=document.createElement("div"); c.className="week-day-cell";
    allday[d].forEach(ev=> c.appendChild(renderAllDayChip(ev)));
    grid.appendChild(c);
  }

  for(let h=8;h<=18;h++){
    grid.appendChild(Object.assign(document.createElement("div"),{className:"week-hour-label",textContent:`${String(h).padStart(2,"0")}:00`}));
    for(let d=0;d<7;d++){
      const c=document.createElement("div"); c.className="week-day-cell";
      (timed[d][h]||[]).forEach(ev=> c.appendChild(renderAllDayChip(ev)));
      grid.appendChild(c);
    }
  }

  container.appendChild(grid);
  calendarBody.innerHTML=""; calendarBody.appendChild(container);
}

/***** VIEW: MÊS *****/
async function renderMonthView(){
  const monthName=currentDate.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  calendarTitle.textContent = monthName.charAt(0).toUpperCase()+monthName.slice(1);

  const firstDay=new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastDay =new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0);

  const startDate=new Date(firstDay); startDate.setDate(startDate.getDate()-firstDay.getDay()); startDate.setHours(0,0,0,0);
  const endDate=new Date(lastDay); endDate.setDate(endDate.getDate()+(6-lastDay.getDay())); endDate.setHours(23,59,59,999);

  await fetchCalendarEvents(startDate, endDate);

  const container=document.createElement("div"); container.className="month-view";
  const weekdays=document.createElement("div"); weekdays.className="calendar-weekdays";
  ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].forEach(d=>{ const el=document.createElement("div"); el.className="weekday"; el.textContent=d; weekdays.appendChild(el); });
  container.appendChild(weekdays);

  const grid=document.createElement("div"); grid.className="calendar-grid";
  const byDate={};
  calendarEvents.forEach(ev=>{
    const start=new Date(ev.start.dateTime||ev.start.date);
    const key=start.toISOString().split("T")[0];
    (byDate[key] ||= []).push(ev);
  });

  const today=new Date(); today.setHours(0,0,0,0);
  const totalDays=Math.ceil((endDate-startDate)/86400000);

  for(let i=0;i<totalDays;i++){
    const cellDate=new Date(startDate); cellDate.setDate(cellDate.getDate()+i);
    const dayCell=document.createElement("div"); dayCell.className="calendar-day";
    if (cellDate.getMonth()!==currentDate.getMonth()) dayCell.classList.add("other-month");
    if (cellDate.toDateString()===today.toDateString()) dayCell.classList.add("today");
    const dayNumber=document.createElement("div"); dayNumber.className="day-number"; dayNumber.textContent=cellDate.getDate(); dayNumber.style.zIndex=1; dayCell.appendChild(dayNumber);

    const key=cellDate.toISOString().split("T")[0];
    (byDate[key]||[]).sort((a,b)=>{
      const aTime=new Date(a.start.dateTime||a.start.date);
      const bTime=new Date(b.start.dateTime||b.start.date);
      return aTime-bTime;
    }).slice(0,4).forEach(ev=>{
      const chip=renderAllDayChip(ev);
      dayCell.appendChild(chip);
    });
    if ((byDate[key]||[]).length>4){
      const more=document.createElement("div"); more.style.cssText="font-size:.7rem;color:#9aa0a6;margin-top:2px"; more.textContent=`+${byDate[key].length-4} mais`;
      dayCell.appendChild(more);
    }
    grid.appendChild(dayCell);
  }

  container.appendChild(grid);
  calendarBody.innerHTML=""; calendarBody.appendChild(container);
}

/***** ROOT + NAVEGAÇÃO *****/
async function renderCalendar(){
  if (currentView==="day") await renderDayView();
  else if (currentView==="week") await renderWeekView();
  else await renderMonthView();
}

$$(".view-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".view-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active"); currentView = btn.dataset.view; renderCalendar();
  });
});
prevPeriodBtn?.addEventListener("click", ()=>{
  if (currentView==="day") currentDate.setDate(currentDate.getDate()-1);
  else if (currentView==="week") currentDate.setDate(currentDate.getDate()-7);
  else currentDate.setMonth(currentDate.getMonth()-1);
  renderCalendar();
});
nextPeriodBtn?.addEventListener("click", ()=>{
  if (currentView==="day") currentDate.setDate(currentDate.getDate()+1);
  else if (currentView==="week") currentDate.setDate(currentDate.getDate()+7);
  else currentDate.setMonth(currentDate.getMonth()+1);
  renderCalendar();
});
todayBtn?.addEventListener("click", ()=>{
  currentDate = new Date();
  renderCalendar();
});

setStatus("Carregando…");
renderCalendar();
