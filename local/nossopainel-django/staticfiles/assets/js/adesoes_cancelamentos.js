/* Adesao e Cancelamentos - renderizacao do grafico (Chart.js) */

(function () {
  let chartInstance = null;
  let currentKey = null;

  const $canvas = () => document.getElementById('adesaoCancelChart');
  const $wrapper = () => document.getElementById('adesao-cancel-chart-wrapper');
  const $empty = () => document.getElementById('adesao-cancel-empty');
  const $summary = () => document.getElementById('adesao-cancel-summary');
  const $modeSelect = () => document.getElementById('adesao-cancelamentos-mode');
  const $monthSelect = () => document.getElementById('adesao-cancelamentos-month');
  const $yearSelect = () => document.getElementById('adesao-cancelamentos-year');
  const $monthGroup = () => document.getElementById('adesao-cancelamentos-month-group');
  const $yearGroup = () => document.getElementById('adesao-cancelamentos-year-group');

  const MONTH_LABELS = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ];

  function populateControls() {
    const monthSelect = $monthSelect();
    const yearSelect = $yearSelect();
    if (!monthSelect || !yearSelect) return;

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    monthSelect.value = String(currentMonth);

    if (!yearSelect.options.length) {
      for (let offset = 0; offset < 6; offset += 1) {
        const year = currentYear - offset;
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
      }
    }

    if (!yearSelect.value) {
      yearSelect.value = String(currentYear);
    }
  }

  function toggleControls(mode) {
    const monthGroup = $monthGroup();
    if (!monthGroup) return;

    const yearGroup = $yearGroup();

    if (mode === 'monthly') {
      monthGroup.classList.remove('d-none');
      yearGroup?.classList.remove('d-none');
    } else if (mode === 'annual') {
      monthGroup.classList.add('d-none');
      yearGroup?.classList.remove('d-none');
    } else {
      monthGroup.classList.add('d-none');
      yearGroup?.classList.add('d-none');
    }
  }

  function showEmpty(message) {
    const empty = $empty();
    const canvas = $canvas();
    const summary = $summary();

    if (chartInstance) {
      try { chartInstance.destroy(); } catch (err) { console.warn('Falha ao destruir grafico:', err); }
      chartInstance = null;
      currentKey = null;
    }

    if (summary) summary.textContent = '';
    if (empty) {
      empty.textContent = message || 'Nenhum dado encontrado para o filtro selecionado.';
      empty.classList.remove('d-none');
    }
    if (canvas) {
      canvas.classList.add('d-none');
    }
  }

  function hideEmpty() {
    const empty = $empty();
    const canvas = $canvas();
    if (empty) empty.classList.add('d-none');
    if (canvas) canvas.classList.remove('d-none');
  }

  function buildSummary(summary, meta) {
    const summaryBox = $summary();
    if (!summaryBox) return;
    // Removido conforme solicitado - os totais agora aparecem nas legendas
    summaryBox.textContent = '';
  }

  function composeDatasets(series, summary) {
    // Extrair totais do summary
    const totals = {
      adesoes: summary?.total_adesoes || 0,
      cancelamentos: summary?.total_cancelamentos || 0,
      saldo: summary?.saldo || 0,
    };

    const datasets = [];

    // Encontrar as séries
    const saldoSerie = (series || []).find(s => s.key === 'saldo');
    const adesoesSerie = (series || []).find(s => s.key === 'adesoes');
    const cancelamentosSerie = (series || []).find(s => s.key === 'cancelamentos');

    // 1. Barra de Adesões (verde) - lado esquerdo
    if (adesoesSerie) {
      const total = totals.adesoes || 0;
      const adesoesData = (adesoesSerie.data || []).map((value) => Number(value || 0));
      datasets.push({
        type: 'bar',
        label: `${adesoesSerie.name || 'Adesões'}: ${total}`,
        data: adesoesData,
        backgroundColor: '#10b981',
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.7,
        categoryPercentage: 0.6,
        order: 2,
      });
    }

    // 2. Barra de Cancelamentos (vermelho) - lado direito
    if (cancelamentosSerie) {
      const total = totals.cancelamentos || 0;
      const cancelamentosData = (cancelamentosSerie.data || []).map((value) => Number(value || 0));
      datasets.push({
        type: 'bar',
        label: `${cancelamentosSerie.name || 'Cancelamentos'}: ${total}`,
        data: cancelamentosData,
        backgroundColor: '#f43f5e',
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.7,
        categoryPercentage: 0.6,
        order: 3,
      });
    }

    // 3. Linha de Saldo (azul/roxo) - eixo Y secundário
    if (saldoSerie) {
      const saldoData = (saldoSerie.data || []).map((value) => Number(value || 0));
      const total = totals.saldo || 0;
      const prefix = total > 0 ? '+' : '';

      datasets.push({
        type: 'line',
        label: `${saldoSerie.name || 'Saldo'}: ${prefix}${total}`,
        data: saldoData,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        tension: 0.35,
        fill: false,
        yAxisID: 'y1',
        pointRadius: 3,
        pointHoverRadius: 4,
        order: 1,
      });
    }

    return datasets;
  }

  const stackedValueLabels = {
    id: 'stackedValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (dataset.type !== 'bar') return;
        if (!chart.isDatasetVisible(datasetIndex)) return;
        const meta = chart.getDatasetMeta(datasetIndex);
        ctx.save();
        ctx.font = '600 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = dataset.valueLabelColor || '#111827';

        meta.data.forEach((bar, index) => {
          const rawValue = dataset.data[index];
          if (rawValue === 0 || rawValue === null || rawValue === undefined) return;
          const props = bar.getProps(['y', 'base'], true);
          const height = props.base - props.y;
          if (Math.abs(height) < 8) return;
          const textY = props.y + (height / 2);
          ctx.fillText(String(rawValue), bar.x, textY);
        });
        ctx.restore();
      });
    },
  };

  function buildChart(payload) {
    const canvas = $canvas();
    if (!canvas) return;

    const categories = payload?.categories || [];
    const datasets = composeDatasets(payload?.series || [], payload?.summary);

    if (!categories.length || !datasets.some((d) => d.data && d.data.some((value) => Number(value) !== 0))) {
      showEmpty('Nenhum dado encontrado para o filtro selecionado.');
      return;
    }

    hideEmpty();
    buildSummary(payload.summary, payload.meta);

    const data = {
      labels: categories,
      datasets,
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        title: {
          display: Boolean(payload?.meta?.range_label),
          text: payload?.meta?.range_label || '',
          font: { size: 16, weight: '600' },
          color: '#0f172a',
          padding: { bottom: 16 },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed.y;
              // Extrair apenas o nome base sem o total (ex: "Adesões: 3" -> "Adesões")
              const labelBase = context.dataset.label.split(':')[0].trim();
              return `${labelBase}: ${value}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: false,
          grid: { display: false },
        },
        y: {
          stacked: false,
          beginAtZero: true,
          ticks: {
            precision: 0,
            stepSize: 1,
          },
          grid: { color: 'rgba(15, 23, 42, 0.08)' },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            precision: 0,
            stepSize: 1,
          },
        },
      },
    };

    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data,
      options,
      plugins: [stackedValueLabels],
    });
  }

  async function fetchData(params) {
    const query = new URLSearchParams(params);
    const url = `/api/adesoes-cancelamentos/?${query.toString()}`;
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(`Falha ao carregar dados (${resp.status})`);
      return await resp.json();
    } catch (err) {
      console.error('Erro ao buscar dados de adesao/cancelamentos:', err);
      showEmpty('N\u00e3o foi poss\u00edvel carregar os dados. Tente novamente mais tarde.');
      return null;
    }
  }

  async function ensureChart(forceUpdate = false) {
    const canvas = $canvas();
    if (!canvas) return;

    const mode = ($modeSelect()?.value || 'monthly').toLowerCase();
    const month = $monthSelect()?.value || '';
    const year = $yearSelect()?.value || '';
    const key = `${mode}-${month}-${year}`;

    if (!forceUpdate && chartInstance && currentKey === key) {
      try {
        chartInstance.resize();
      } catch (err) {
        console.warn('Falha ao redimensionar grafico:', err);
      }
      return;
    }

    const params = { mode };
    if (mode === 'monthly') {
      if (month) params.month = month;
      if (year) params.year = year;
    } else if (mode === 'annual') {
      if (year) params.year = year;
    } else if (mode === 'lifetime') {
      // nenhum argumento adicional
    } else if (year) {
      params.year = year;
    }

    const payload = await fetchData(params);
    if (!payload) return;
    currentKey = key;
    buildChart(payload);
  }

  document.addEventListener('DOMContentLoaded', () => {
    populateControls();
    toggleControls(($modeSelect()?.value || 'monthly').toLowerCase());

    const modeSelect = $modeSelect();
    const monthSelect = $monthSelect();
    const yearSelect = $yearSelect();
    const tabBtn = document.getElementById('tab-adesao-cancelamentos');

    if (modeSelect) {
      modeSelect.addEventListener('change', (event) => {
        const value = (event.target.value || 'monthly').toLowerCase();
        toggleControls(value);
        ensureChart(true);
      });
    }
    if (monthSelect) {
      monthSelect.addEventListener('change', () => ensureChart(true));
    }
    if (yearSelect) {
      yearSelect.addEventListener('change', () => ensureChart(true));
    }
    if (tabBtn) {
      tabBtn.addEventListener('shown.bs.tab', () => {
        ensureChart(true);
      });
    }
  });
})();
