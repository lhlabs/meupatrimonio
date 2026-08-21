// Compositor visual da Home. Não recalcula valores: espelha as métricas oficiais
// renderizadas por app.js e apenas organiza a leitura financeira em primeiro plano.

const $ = selector => document.querySelector(selector);

function metricText(id, fallback = '—') {
  return document.getElementById(id)?.textContent?.trim() || fallback;
}

function moneyValue(text) {
  const normalized = String(text || '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function addOverviewStyles() {
  if ($('#financialOverviewStyles')) return;
  const style = document.createElement('style');
  style.id = 'financialOverviewStyles';
  style.textContent = `
    .financial-overview-ready #dashboardSection > .command-grid,
    .financial-overview-ready #dashboardSection > .metric-strip { display:none; }

    .financial-overview {
      margin: 10px 0 18px;
      padding: 18px;
      border: 1px solid rgba(148,163,184,.16);
      border-radius: 24px;
      background:
        radial-gradient(circle at 8% 0%, rgba(79,209,163,.12), transparent 34%),
        linear-gradient(145deg, rgba(14,27,45,.96), rgba(8,18,32,.96));
      box-shadow: 0 18px 46px rgba(0,0,0,.18);
    }

    .financial-overview-head {
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:16px;
      margin-bottom:16px;
    }

    .financial-overview-head h2 {
      margin:4px 0 4px;
      font-size:clamp(1.25rem, 2vw, 1.65rem);
      letter-spacing:-.03em;
    }

    .financial-overview-head p { margin:0; }

    .financial-overview-status {
      display:flex;
      flex-direction:column;
      align-items:flex-end;
      gap:7px;
      text-align:right;
      white-space:nowrap;
    }

    .overview-status-pill {
      display:inline-flex;
      align-items:center;
      gap:6px;
      min-height:30px;
      padding:5px 10px;
      border-radius:999px;
      border:1px solid rgba(148,163,184,.18);
      background:rgba(255,255,255,.055);
      font-size:.78rem;
      font-weight:700;
    }

    .overview-status-pill.positive { color:#6ee7b7; border-color:rgba(110,231,183,.25); }
    .overview-status-pill.negative { color:#fda4af; border-color:rgba(253,164,175,.25); }

    .financial-overview-grid {
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:12px;
    }

    .overview-metric {
      min-width:0;
      min-height:132px;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      gap:12px;
      padding:16px;
      border-radius:18px;
      border:1px solid rgba(148,163,184,.14);
      background:rgba(255,255,255,.045);
    }

    .overview-metric.primary {
      background:linear-gradient(145deg, rgba(79,209,163,.13), rgba(255,255,255,.035));
      border-color:rgba(79,209,163,.22);
    }

    .overview-metric > span {
      color:rgba(226,232,240,.72);
      font-size:.78rem;
      font-weight:750;
      letter-spacing:.03em;
      text-transform:uppercase;
    }

    .overview-metric strong {
      display:block;
      overflow:hidden;
      text-overflow:ellipsis;
      font-size:clamp(1.25rem,2.3vw,1.75rem);
      letter-spacing:-.035em;
      white-space:nowrap;
    }

    .overview-metric small {
      color:rgba(203,213,225,.64);
      line-height:1.35;
    }

    .overview-metric.result-positive strong { color:#6ee7b7; }
    .overview-metric.result-negative strong { color:#fda4af; }

    .financial-overview-foot {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:14px;
      margin-top:15px;
      padding-top:14px;
      border-top:1px solid rgba(148,163,184,.12);
    }

    .overview-secondary {
      display:flex;
      flex-wrap:wrap;
      gap:8px 16px;
      color:rgba(203,213,225,.72);
      font-size:.82rem;
    }

    .overview-secondary strong { color:inherit; }

    .overview-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; }

    .overview-action {
      min-height:36px;
      padding:7px 11px;
      border:1px solid rgba(148,163,184,.17);
      border-radius:11px;
      background:rgba(255,255,255,.045);
      color:inherit;
      font:inherit;
      font-size:.8rem;
      font-weight:700;
      cursor:pointer;
    }

    .overview-action.primary-action {
      border-color:rgba(79,209,163,.24);
      background:rgba(79,209,163,.12);
    }

    @media (max-width: 900px) {
      .financial-overview-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .financial-overview-foot { align-items:flex-start; flex-direction:column; }
      .overview-actions { justify-content:flex-start; }
    }

    @media (max-width: 560px) {
      .financial-overview { padding:14px; border-radius:20px; }
      .financial-overview-head { flex-direction:column; }
      .financial-overview-status { align-items:flex-start; text-align:left; }
      .overview-metric { min-height:118px; padding:14px; }
      .overview-metric strong { font-size:1.2rem; }
      .overview-actions { width:100%; display:grid; grid-template-columns:1fr 1fr; }
      .overview-action { width:100%; }
    }
  `;
  document.head.appendChild(style);
}

function mountOverview() {
  if ($('#financialOverview')) return;
  const dashboard = $('#dashboardSection');
  const monthRow = dashboard?.querySelector('.month-row');
  if (!dashboard || !monthRow) return;

  const overview = document.createElement('section');
  overview.id = 'financialOverview';
  overview.className = 'financial-overview';
  overview.setAttribute('aria-label', 'Resumo da situação financeira');
  overview.innerHTML = `
    <div class="financial-overview-head">
      <div>
        <span class="card-kicker">SITUAÇÃO FINANCEIRA</span>
        <h2>O que importa agora</h2>
        <p class="muted">Caixa real, compromissos e projeção do mês em uma única leitura.</p>
      </div>
      <div class="financial-overview-status">
        <span id="overviewMonth" class="overview-status-pill">Mês atual</span>
        <span id="overviewStatus" class="overview-status-pill">Calculando projeção</span>
      </div>
    </div>

    <div class="financial-overview-grid">
      <article class="overview-metric primary">
        <span>Disponível hoje</span>
        <strong id="overviewAvailable">—</strong>
        <small>Saldo real consolidado das carteiras.</small>
      </article>
      <article class="overview-metric">
        <span>Gastos comprometidos</span>
        <strong id="overviewCommitted">—</strong>
        <small>Realizados + recorrentes + agendados do mês.</small>
      </article>
      <article id="overviewResultCard" class="overview-metric">
        <span>Resultado projetado</span>
        <strong id="overviewResult">—</strong>
        <small>Receitas menos gastos já considerados para o mês.</small>
      </article>
      <article class="overview-metric">
        <span>Patrimônio</span>
        <strong id="overviewPatrimony">—</strong>
        <small>Ativos consolidados conforme sua regra patrimonial atual.</small>
      </article>
    </div>

    <div class="financial-overview-foot">
      <div class="overview-secondary">
        <span>Cartões em aberto: <strong id="overviewCards">—</strong></span>
        <span>Reserva: <strong id="overviewReserve">—</strong></span>
        <span>Score: <strong id="overviewScore">—</strong>/100</span>
      </div>
      <div class="overview-actions">
        <button class="overview-action primary-action" type="button" data-overview-action="new">+ Lançamento</button>
        <button class="overview-action" type="button" data-overview-action="patrimony">Carteiras</button>
        <button class="overview-action" type="button" data-overview-action="agenda">Agenda</button>
        <button class="overview-action" type="button" data-overview-action="transactions">Lançamentos</button>
      </div>
    </div>
  `;

  monthRow.insertAdjacentElement('afterend', overview);
  document.documentElement.classList.add('financial-overview-ready');

  overview.addEventListener('click', event => {
    const action = event.target.closest?.('[data-overview-action]')?.dataset.overviewAction;
    if (!action) return;
    if (action === 'new') {
      $('#quickAddBtn')?.click();
      return;
    }
    document.querySelector(`[data-page="${action}"]`)?.click();
  });
}

function syncOverview() {
  if (!$('#financialOverview')) return;

  const mappings = {
    overviewAvailable: ['walletsTotal', 'R$ 0,00'],
    overviewCommitted: ['debtValue', 'R$ 0,00'],
    overviewResult: ['monthBalance', 'R$ 0,00'],
    overviewPatrimony: ['netWorth', 'R$ 0,00'],
    overviewCards: ['cardsOpenTotal', 'R$ 0,00'],
    overviewReserve: ['reserveMonths', '0,0 meses'],
    overviewScore: ['financeScore', '0'],
    overviewMonth: ['monthLabel', 'Mês atual']
  };

  Object.entries(mappings).forEach(([targetId, [sourceId, fallback]]) => {
    const target = document.getElementById(targetId);
    const value = metricText(sourceId, fallback);
    if (target && target.textContent !== value) target.textContent = value;
  });

  const result = moneyValue(metricText('monthBalance'));
  const resultCard = $('#overviewResultCard');
  const status = $('#overviewStatus');
  resultCard?.classList.toggle('result-positive', result > 0);
  resultCard?.classList.toggle('result-negative', result < 0);

  if (status) {
    status.classList.toggle('positive', result > 0);
    status.classList.toggle('negative', result < 0);
    const message = result > 0
      ? '● Mês projetado no azul'
      : result < 0
        ? '● Atenção ao fechamento'
        : '● Mês projetado equilibrado';
    if (status.textContent !== message) status.textContent = message;
  }
}

function initOverview() {
  addOverviewStyles();
  mountOverview();
  syncOverview();

  const appView = $('#appView');
  if (appView) {
    const observer = new MutationObserver(() => {
      mountOverview();
      syncOverview();
    });
    observer.observe(appView, { subtree:true, childList:true, characterData:true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOverview, { once:true });
} else {
  initOverview();
}
