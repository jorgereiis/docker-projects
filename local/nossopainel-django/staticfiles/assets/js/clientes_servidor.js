/* Gráfico de Clientes por Servidor */
(function () {
  const API_URL = "/api/clientes-por-servidor/";
  const COLORS = [
    "#624bff",
    "#36c8cf",
    "#f4c06a",
    "#ff7ab8",
    "#2bc670",
    "#8b6aff",
    "#ffa175",
    "#21b9e3",
    "#ffb5d2",
    "#4dd298",
    "#a974ff",
    "#5ac4ff",
  ];
  const state = { chart: null };
  const MAX_LEGEND_ITEMS = 10;

  const formatNumber = (value) =>
    new Intl.NumberFormat("pt-BR").format(Number(value) || 0);

  const formatPercent = (value) => {
    const numeric = Number(value) || 0;
    const places = numeric >= 10 ? 1 : 2;
    return `${numeric.toFixed(places)}%`;
  };

  document.addEventListener("DOMContentLoaded", () => {
    const selectEl = document.getElementById("clientes-servidor-select");
    const wrapper = document.getElementById("clientes-servidor-chart");
    if (!selectEl || !wrapper) {
      return;
    }

    const loadingEl = wrapper.querySelector(".clientes-servidor-loading");
    const emptyEl = wrapper.querySelector(".clientes-servidor-empty");
    const canvasEl = wrapper.querySelector(".clientes-servidor-canvas-element");
    const legendEl = wrapper.querySelector(".clientes-servidor-legend");

    if (!loadingEl || !emptyEl || !canvasEl || !legendEl) {
      return;
    }

    const ctx = canvasEl.getContext("2d");

    selectEl.addEventListener("change", (event) => {
      const value = event.target.value || "todos";
      loadData(value);
    });

    loadData("todos");

    async function loadData(filterValue) {
      toggleSelect(true);
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filterValue && filterValue !== "todos") {
          params.set("servidor", filterValue);
        } else {
          params.set("servidor", "todos");
        }

        const query = params.toString();
        const url = query ? `${API_URL}?${query}` : API_URL;

        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }

        const data = await response.json();
        populateSelect(data.options || [], data.selected);
        updateChart(data.segments || []);
      } catch (error) {
        console.error("[ClientesServidor] Falha ao carregar dados:", error);
        showEmpty(
          "Não foi possível carregar o gráfico. Atualize a página e tente novamente."
        );
      } finally {
        setLoading(false);
        toggleSelect(false);
      }
    }

    function toggleSelect(disabled) {
      selectEl.disabled = !!disabled;
    }

    function setLoading(isLoading) {
      loadingEl.classList.toggle("d-none", !isLoading);
      if (isLoading) {
        emptyEl.classList.add("d-none");
        canvasEl.classList.add("d-none");
        legendEl.classList.add("d-none");
      }
    }

    function showEmpty(message) {
      destroyChart();
      emptyEl.textContent =
        message || "Nenhum cliente encontrado para o filtro selecionado.";
      emptyEl.classList.remove("d-none");
      canvasEl.classList.add("d-none");
      legendEl.classList.add("d-none");
    }

    function hideEmpty() {
      emptyEl.classList.add("d-none");
    }

    function populateSelect(options, selectedLabel) {
      selectEl.innerHTML = "";

      if (!Array.isArray(options) || !options.length) {
        const option = document.createElement("option");
        option.value = "todos";
        option.textContent = "Todos os Servidores";
        option.selected = true;
        selectEl.appendChild(option);
        return;
      }

      options.forEach((label) => {
        const option = document.createElement("option");
        option.value = label === "Todos os Servidores" ? "todos" : label;
        option.textContent = label;
        if (label === selectedLabel) {
          option.selected = true;
        }
        selectEl.appendChild(option);
      });

      if (!selectEl.value) {
        selectEl.value = "todos";
      }
    }

    function updateChart(segments) {
      if (!Array.isArray(segments) || !segments.length) {
        showEmpty("Nenhum cliente encontrado para o filtro selecionado.");
        return;
      }

      hideEmpty();
      canvasEl.classList.remove("d-none");
      legendEl.classList.remove("d-none");

      const labels = segments.map((segment) => segment.label || "N/D");
      const values = segments.map((segment) => Number(segment.value) || 0);
      const percents = segments.map((segment) => Number(segment.percent) || 0);
      const colors = labels.map(
        (_, index) => COLORS[index % COLORS.length]
      );

      legendEl.innerHTML = "";
      segments.forEach((segment, index) => {
        if (index >= MAX_LEGEND_ITEMS) {
          return;
        }
        const legendItem = document.createElement("div");
        legendItem.className = "clientes-servidor-legend-item";

        const colorDot = document.createElement("span");
        colorDot.className = "clientes-servidor-legend-color";
        colorDot.style.backgroundColor = colors[index];

        const textSpan = document.createElement("span");
        textSpan.className = "clientes-servidor-legend-text";
        const percentStrong = document.createElement("strong");
        percentStrong.textContent = formatPercent(percents[index]);
        textSpan.appendChild(percentStrong);
        textSpan.appendChild(
          document.createTextNode(` ${segment.label || "N/D"}`)
        );

        legendItem.appendChild(colorDot);
        legendItem.appendChild(textSpan);

        legendEl.appendChild(legendItem);
      });

      if (segments.length > MAX_LEGEND_ITEMS) {
        const note = document.createElement("div");
        note.className = "clientes-servidor-legend-note";
        note.textContent = "Mostrando os 10 principais itens. Consulte o gráfico para os demais.";
        legendEl.appendChild(note);
      }

      destroyChart();
      if (typeof Chart === "undefined") {
        console.error("[ClientesServidor] Chart.js não está disponível.");
        showEmpty("Não foi possível inicializar o gráfico no momento.");
        return;
      }
      state.chart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels,
          datasets: [
            {
              data: values,
              backgroundColor: colors,
              borderWidth: 1,
              customPercents: percents,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "60%",
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                title: (items) => (items[0] ? items[0].label : ""),
                label: (context) => {
                  const value = Number(context.raw) || 0;
                  const percent =
                    context.dataset.customPercents?.[context.dataIndex] || 0;
                  const label = formatNumber(value);
                  const plural = value === 1 ? "" : "s";
                  return `${label} cliente${plural} (${formatPercent(percent)})`;
                },
              },
            },
          },
        },
      });
    }

    function destroyChart() {
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
    }
  });
})();
