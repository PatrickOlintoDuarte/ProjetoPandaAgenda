// app.js
(() => {
  // ========== CONFIG GOOGLE ==========
  const CLIENT_ID   = "371129341051-8ukpj3l1chk4jccdhanm5mvu3h2ajnm0.apps.googleusercontent.com"; // OAuth Client ID (Web)
  const API_KEY     = "AIzaSyB0-Hu46SyozXxkj7_ACIIhY2Jv6RfY8VM";                                   // API Key
  const CALENDAR_ID = "f115236e50fdb661333dfef8b424cfac22446bb8624c5f6ce3ddb1d666f3e102@group.calendar.google.com";

  const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
  const SCOPES = "https://www.googleapis.com/auth/calendar.events";

  // ========== ELEMENTOS EXISTENTES ==========
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const clienteEl = $("#cliente");
  const telefoneEl = $("#telefone");
  const emailEl = $("#email");
  const regiaoEl = $("#regiao");
  const dataEl = $("#dataAgendamento");
  const tipoServicoEl = $("#tipoServico");
  const tecnicoEl = $("#tecnico");
  const enderecoEl = $("#endereco");

  const timeSlotsWrap = $("#timeSlots");
  const btnAgendar = $("#btnAgendar");
  const alertContainer = $("#alertContainer");
  const limitsGrid = $("#limitsGrid");
  const calendarContainer = document.querySelector(".calendar-container");
  const TIMEZONE = "America/Sao_Paulo";

  // Botão de login (se não existir, criaremos)
  let btnLogin = $("#btnLoginGoogle");
  if (!btnLogin) {
    btnLogin = document.createElement("button");
    btnLogin.id = "btnLoginGoogle";
    btnLogin.className = "btn";
    btnLogin.textContent = "🔐 Conectar Google";
    btnAgendar.insertAdjacentElement("beforebegin", btnLogin);
  }

  // Barra de atualizar iframe
  const refreshBar = document.createElement("div");
  refreshBar.style.margin = "10px 0 0";
  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "🔄 Atualizar Agenda do Google";
  refreshBtn.className = "btn";
  refreshBtn.addEventListener("click", () => {
    const iframe = calendarContainer.querySelector("iframe");
    if (iframe) {
      const src = iframe.src;
      iframe.src = "";
      setTimeout(() => (iframe.src = src), 50);
    }
  });
  refreshBar.appendChild(refreshBtn);
  calendarContainer.prepend(refreshBar);

  // ========== ALERTAS ==========
  function showAlert(msg, type = "info") {
    alertContainer.innerHTML = "";
    const el = document.createElement("div");
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    alertContainer.appendChild(el);
    setTimeout(() => {
      if (alertContainer.contains(el)) el.remove();
    }, 5000);
  }

  // ========== LIMITE POR REGIÃO ==========
  const LIMITES = {
    "santo-andre": 6,
    "diadema": 5,
    "sao-bernardo": 7,
    "sao-caetano": 5,
    "ribeirao-pires": 4,
    "maua": 6,
  };
  function labelRegiao(v) {
    switch (v) {
      case "santo-andre": return "Santo André";
      case "diadema": return "Diadema";
      case "sao-bernardo": return "São Bernardo do Campo";
      case "sao-caetano": return "São Caetano do Sul";
      case "ribeirao-pires": return "Ribeirão Pires";
      case "maua": return "Mauá";
      default: return v;
    }
  }

  // Persistência local
  function loadAgendamentos() {
    try { return JSON.parse(localStorage.getItem("agendamentos_panda_fibra") || "[]"); }
    catch { return []; }
  }
  function saveAgendamentos(lista) {
    localStorage.setItem("agendamentos_panda_fibra", JSON.stringify(lista));
  }
  function countAgendamentosPorRegiaoNaData(dataISO) {
    const todos = loadAgendamentos();
    const mapa = {};
    Object.keys(LIMITES).forEach((k) => (mapa[k] = 0));
    todos.forEach((item) => {
      if (item.data === dataISO && mapa.hasOwnProperty(item.regiao)) mapa[item.regiao] += 1;
    });
    return mapa;
  }
  function renderLimites() {
    const dataISO = dataEl.value;
    limitsGrid.innerHTML = "";
    const counts = countAgendamentosPorRegiaoNaData(dataISO);
    Object.entries(LIMITES).forEach(([key, limite]) => {
      const usados = counts[key] || 0;
      const livre = Math.max(limite - usados, 0);
      const card = document.createElement("div");
      card.className = "limit-card";
      card.innerHTML = `
        <div class="limit-title">${labelRegiao(key)}</div>
        <div class="limit-row"><span>Capacidade:</span> <strong>${limite}</strong></div>
        <div class="limit-row"><span>Agendados:</span> <strong>${usados}</strong></div>
        <div class="limit-row"><span>Disponíveis:</span> <strong ${livre === 0 ? 'style="color:#ef4444;"' : ""}>${livre}</strong></div>
      `;
      limitsGrid.appendChild(card);
    });
  }
  renderLimites();

  // ========== SLOTS ==========
  function clearTimeSlotSelection() {
    $$("#timeSlots .time-slot").forEach((el) => el.classList.remove("selected"));
  }
  function getSelectedTimeSlot() {
    const el = $("#timeSlots .time-slot.selected");
    return el ? el.textContent.trim() : "";
  }
  dataEl.addEventListener("change", () => {
    timeSlotsWrap.style.display = dataEl.value ? "grid" : "none";
    if (!dataEl.value) clearTimeSlotSelection();
    renderLimites();
    renderDailyList();
  });
  $$("#timeSlots .time-slot").forEach((slot) => {
    slot.addEventListener("click", () => {
      clearTimeSlotSelection();
      slot.classList.add("selected");
    });
  });

  // ========== LISTA DO DIA ==========
  const dailyList = document.createElement("div");
  dailyList.id = "dailyList";
  dailyList.style.marginTop = "16px";
  document.querySelector(".form-section").appendChild(dailyList);
  function tipoServicoLabel(val) {
    const map = {
      "manutencao": "Manutenção",
      "instalacao-adiz": "Instalação ADIZ",
      "implementacao-arezzo": "Implementação AREZZO",
    };
    return map[val] || val;
  }
  function tecnicoLabel(val) {
    const opt = [...tecnicoEl.options].find((o) => o.value === val);
    return opt ? opt.text : val;
  }
  function renderDailyList() {
    const dataISO = dataEl.value;
    const todos = loadAgendamentos().filter((a) => a.data === dataISO);
    dailyList.innerHTML = `<h3>🗒️ Agendamentos do Dia</h3>`;
    if (!dataISO) {
      dailyList.insertAdjacentHTML("beforeend", `<p>Selecione uma data para ver os agendamentos.</p>`);
      return;
    }
    if (!todos.length) {
      dailyList.insertAdjacentHTML("beforeend", `<p>Nenhum agendamento para ${dataISO}.</p>`);
      return;
    }
    const ul = document.createElement("ul");
    ul.style.listStyle = "none";
    ul.style.padding = "0";
    todos
      .sort((a, b) => a.horario.localeCompare(b.horario))
      .forEach((a) => {
        const li = document.createElement("li");
        li.style.margin = "8px 0";
        li.style.padding = "8px 10px";
        li.style.border = "1px solid #e5e7eb";
        li.style.borderRadius = "8px";
        li.innerHTML = `
          <div><strong>${a.horario}</strong> — ${a.cliente} (${labelRegiao(a.regiao)})</div>
          <div style="font-size: 0.95em; color:#374151;">${a.endereco}</div>
          <div style="font-size: 0.9em; color:#6b7280;">${tipoServicoLabel(a.tipoServico)} • ${tecnicoLabel(a.tecnico)}</div>
        `;
        ul.appendChild(li);
      });
    dailyList.appendChild(ul);
  }
  renderDailyList();

  // ========== VALIDAÇÃO ==========
  function validar() {
    const faltando = [];
    if (!clienteEl.value.trim()) faltando.push("Nome do Cliente");
    if (!telefoneEl.value.trim()) faltando.push("Telefone");
    if (!emailEl.value.trim()) faltando.push("E-mail");
    if (!regiaoEl.value) faltando.push("Região");
    if (!dataEl.value) faltando.push("Data");
    if (!tipoServicoEl.value) faltando.push("Tipo de Serviço");
    if (!tecnicoEl.value) faltando.push("Técnico");
    if (!enderecoEl.value.trim()) faltando.push("Endereço");
    const horario = getSelectedTimeSlot();
    if (!horario) faltando.push("Horário");

    if (faltando.length) {
      showAlert(`Preencha os campos: ${faltando.join(", ")}.`, "error");
      return { ok: false };
    }

    // Limite por região
    const counts = countAgendamentosPorRegiaoNaData(dataEl.value);
    const usados = counts[regiaoEl.value] || 0;
    const limite = LIMITES[regiaoEl.value] ?? 0;
    if (usados >= limite) {
      showAlert(`Limite para ${labelRegiao(regiaoEl.value)} na data escolhida foi atingido (${limite}).`, "error");
      return { ok: false };
    }
    return { ok: true, horario };
  }

  // ========== TIME HELPERS ==========
  function parseHourToDate(dateStr, hhmm) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = hhmm.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0);
  }

  // ========== GOOGLE AUTH ==========
  let tokenClient = null;
  let gapiInited = false;
  let gisInited = false;
  let accessToken = null;

  // Carrega gapi client
  window.addEventListener("load", () => {
    if (window.gapi) {
      window.gapi.load("client", async () => {
        try {
          await window.gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
          gapiInited = true;
          maybeEnableUI();
        } catch (err) {
          console.error(err);
          showAlert("Falha ao inicializar Google API Client.", "error");
        }
      });
    }
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        prompt: "", // manter vazio aqui; vamos forçar consentimento no botão
        callback: (resp) => {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            showAlert("Conectado ao Google com sucesso.", "success");
          } else {
            showAlert("Não foi possível obter autorização do Google.", "error");
          }
        },
      });
      gisInited = true;
      maybeEnableUI();
    }
  });

  function maybeEnableUI() {
    if (gapiInited && gisInited) {
      btnLogin.disabled = false;
    }
  }

  // >>> ALTERAÇÃO: força consentimento no clique do login
  btnLogin.addEventListener("click", (e) => {
    e.preventDefault();
    if (!tokenClient) {
      showAlert("Google Identity Services não inicializado.", "error");
      return;
    }
    tokenClient.requestAccessToken({ prompt: "consent" }); // << força consent
  });

  async function ensureSignedIn() {
    if (accessToken) return true;
    return new Promise((resolve) => {
      if (!tokenClient) return resolve(false);
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          resolve(true);
        } else {
          resolve(false);
        }
      };
      tokenClient.requestAccessToken({ prompt: "consent" });
    });
  }

  // ========== CRIAÇÃO DO EVENTO ==========
  async function createCalendarEvent(eventBody) {
    window.gapi.client.setToken({ access_token: accessToken });
    const res = await window.gapi.client.calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: eventBody,
      sendUpdates: "all",
    });
    return res.result;
  }

  function makeEventBody({ titulo, descricao, endereco, inicio, fim }) {
    return {
      summary: titulo,
      description: descricao,
      location: endereco,
      start: { dateTime: inicio.toISOString(), timeZone: TIMEZONE },
      end:   { dateTime: fim.toISOString(),    timeZone: TIMEZONE },
      reminders: { useDefault: true },
    };
  }

  // ========== CLICK AGENDAR ==========
  btnAgendar.addEventListener("click", async (e) => {
    e.preventDefault();

    // >>> ALTERAÇÃO: impede agendar antes de gapi/GIS carregarem
    if (!gapiInited || !gisInited) {
      showAlert("Serviços do Google ainda carregando. Tente novamente em 1–2s.", "error");
      return;
    }

    const { ok, horario } = validar();
    if (!ok) return;

    // Gera dados
    const inicio = parseHourToDate(dataEl.value, horario);
    const fim = new Date(inicio.getTime() + 60 * 60 * 1000);
    const regionLabel = labelRegiao(regiaoEl.value);
    const titulo = `[${regionLabel}] ${tipoServicoEl.options[tipoServicoEl.selectedIndex].text} - ${clienteEl.value}`;
    const descricao =
      `Cliente: ${clienteEl.value}\n` +
      `Telefone: ${telefoneEl.value}\n` +
      `E-mail: ${emailEl.value}\n` +
      `Região: ${regionLabel}\n` +
      `Serviço: ${tipoServicoEl.options[tipoServicoEl.selectedIndex].text}\n` +
      `Técnico: ${tecnicoEl.options[tecnicoEl.selectedIndex].text}\n` +
      `Endereço: ${enderecoEl.value}\n` +
      `Data/Hora: ${dataEl.value} ${horario}\n` +
      `Gerado pelo Sistema de Agendamento Panda Fibra`;

    // 1) Garante login/autorização
    const okSignIn = await ensureSignedIn();
    if (!okSignIn) {
      showAlert("É necessário conectar ao Google para criar o evento no calendário.", "error");
      return;
    }

    try {
      // 2) Cria evento no Google Calendar
      const eventBody = makeEventBody({ titulo, descricao, endereco: enderecoEl.value, inicio, fim });
      const created = await createCalendarEvent(eventBody);

      // 3) Salva localmente (para a UI do site)
      const lista = loadAgendamentos();
      lista.push({
        id: created.id,
        cliente: clienteEl.value.trim(),
        telefone: telefoneEl.value.trim(),
        email: emailEl.value.trim(),
        regiao: regiaoEl.value,
        data: dataEl.value,
        horario,
        tipoServico: tipoServicoEl.value,
        tecnico: tecnicoEl.value,
        endereco: enderecoEl.value.trim(),
        inicioISO: inicio.toISOString(),
        fimISO: fim.toISOString(),
        criadoEm: new Date().toISOString(),
        htmlLink: created.htmlLink,
      });
      saveAgendamentos(lista);

      // 4) Atualiza UI
      renderLimites();
      renderDailyList();

      // 5) Recarrega o iframe para refletir o novo evento
      const iframe = calendarContainer.querySelector("iframe");
      if (iframe) {
        const src = iframe.src;
        iframe.src = "";
        setTimeout(() => (iframe.src = src), 100);
      }

      showAlert("Evento criado automaticamente no Google Calendar! 🎉", "success");

    } catch (err) {
      console.error(err);
      const reason = err?.result?.error?.message || err?.message || "Erro desconhecido";
      showAlert(`Falha ao criar evento no Google Calendar: ${reason}`, "error");
    }
  });

  // ===== (Opcional) Diagnóstico rápido no console: _diagCalendar() =====
  window._diagCalendar = async function() {
    try {
      console.log("gapiInited:", gapiInited, "gisInited:", gisInited, "accessToken:", !!accessToken);
      if (!gapiInited) return console.warn("gapi NÃO inicializado (API_KEY inválida? Calendar API não ativada?).");
      if (!gisInited) return console.warn("GIS NÃO inicializado.");

      await new Promise((resolve) => {
        tokenClient.callback = (resp) => { if (resp?.access_token) { accessToken = resp.access_token; resolve(); } };
        tokenClient.requestAccessToken({ prompt: "consent" });
      });

      gapi.client.setToken({ access_token: accessToken });

      const list = await gapi.client.calendar.calendarList.list();
      console.log("calendarList:", list.result.items?.map(i => ({id: i.id, summary: i.summary, accessRole: i.accessRole})));

      const now = new Date();
      const start = new Date(now.getTime() + 2*60*1000);
      const end   = new Date(start.getTime() + 30*60*1000);
      const ins = await gapi.client.calendar.events.insert({
        calendarId: CALENDAR_ID,
        resource: {
          summary: "🔧 Teste Panda Fibra",
          description: "Evento de diagnóstico",
          start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
          end:   { dateTime: end.toISOString(),   timeZone: "America/Sao_Paulo" },
        }
      });
      console.log("CRIADO ✔", ins.result.htmlLink);
      alert("Evento de teste criado. Veja o console.");
    } catch (err) {
      console.error("DIAGNÓSTICO ERRO:", err?.result || err);
      alert("Falha no diagnóstico. Veja o console (F12).");
    }
  };
})();


