/**
 * Modal de Migração de Clientes
 *
 * Gerencia o fluxo completo de migração de clientes entre usuários:
 * - Step 1: Seleção de usuários (origem e destino)
 * - Step 2: Seleção de clientes via DataTable
 * - Step 3: Validação e confirmação com resumo detalhado
 * - Execução da migração com feedback
 */

(function (factory) {
  if (typeof window.jQuery === 'undefined') {
    window.addEventListener('load', function () {
      if (typeof window.jQuery !== 'undefined') {
        factory(window.jQuery);
      }
    });
  } else {
    factory(window.jQuery);
  }
})(function ($) {
  'use strict';

  $(function () {
    // =====================================
    // CONFIGURAÇÃO CSRF TOKEN
    // =====================================
    function getCsrfToken() {
      // Tentar obter da meta tag primeiro (padrão do projeto)
      let token = $('meta[name="csrf-token"]').attr('content');

      // Se não encontrar na meta tag, tentar obter do cookie
      if (!token) {
        if (document.cookie && document.cookie !== '') {
          const cookies = document.cookie.split(';');
          for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, 10) === 'csrftoken=') {
              token = decodeURIComponent(cookie.substring(10));
              break;
            }
          }
        }
      }

      return token;
    }

    const csrftoken = getCsrfToken();

    // Debug: verificar se o token foi obtido
    if (!csrftoken) {
      console.error('CSRF token não encontrado! Migração pode falhar.');
    } else {
      console.log('CSRF token obtido com sucesso:', csrftoken.substring(0, 10) + '...');
    }

    // Configurar CSRF token para todas as requisições AJAX
    $.ajaxSetup({
      beforeSend: function(xhr, settings) {
        if (!/^(GET|HEAD|OPTIONS|TRACE)$/i.test(settings.type) && !this.crossDomain) {
          xhr.setRequestHeader("X-CSRFToken", csrftoken);
        }
      }
    });

    // =====================================
    // ESTADO GLOBAL DO MODAL
    // =====================================
    const migrationState = {
      currentStep: 1,
      usuarioOrigemId: null,
      usuarioDestinoId: null,
      clientesSelecionados: [],
      allClientes: [],
      validationResult: null,
      dataTable: null,
      usuarios: [],
    };

    // =====================================
    // ELEMENTOS DO DOM
    // =====================================
    const elements = {
      modal: $('#modal-migrar-clientes'),
      selectUsuarioOrigem: $('#usuario-origem'),
      selectUsuarioDestino: $('#usuario-destino'),
      tableClientes: $('#table-clientes-migracao'),
      checkboxSelectAll: $('#checkbox-select-all'),
      badgeClientesSelecionados: $('#badge-clientes-selecionados'),
      btnProximo: $('#btn-proximo-step'),
      btnVoltar: $('#btn-voltar-step'),
      btnExecutar: $('#btn-executar-migracao'),
      btnSelecionarTodos: $('#btn-selecionar-todos'),
      btnLimparSelecao: $('#btn-limpar-selecao'),
      // Filtros
      filtroStatus: $('#filtro-status'),
      filtroServidor: $('#filtro-servidor'),
      filtroPlano: $('#filtro-plano'),
      filtroUF: $('#filtro-uf'),
    };

    // =====================================
    // INICIALIZAÇÃO
    // =====================================

    /**
     * Função global para abrir o modal (chamada do navbar)
     */
    window.modal_migrar_clientes = function() {
      resetModal();
      loadUsuarios();
      elements.modal.modal('show');
    };

    /**
     * Reseta o estado do modal ao abrir
     */
    function resetModal() {
      migrationState.currentStep = 1;
      migrationState.usuarioOrigemId = null;
      migrationState.usuarioDestinoId = null;
      migrationState.clientesSelecionados = [];
      migrationState.allClientes = [];
      migrationState.validationResult = null;

      // Resetar formulários
      elements.selectUsuarioOrigem.val('').prop('disabled', false);
      elements.selectUsuarioDestino.val('').prop('disabled', false);
      elements.tableClientes.find('tbody').empty();
      elements.badgeClientesSelecionados.text('0 clientes selecionados');

      // Mostrar step 1
      goToStep(1);
    }

    /**
     * Carrega lista de usuários do sistema
     */
    function loadUsuarios() {
      // Buscar usuários ativos via AJAX
      $.ajax({
        url: '/user-logs/',
        method: 'GET',
        dataType: 'json',
        success: function(response) {
          if (response.can_view_all && response.users) {
            migrationState.usuarios = response.users;
            populateUsuarioSelects();
          } else {
            showError('Erro ao carregar usuários. Você precisa ser administrador.');
          }
        },
        error: function(xhr) {
          showError('Erro ao buscar lista de usuários: ' + getErrorMessage(xhr));
        }
      });
    }

    /**
     * Popula os selects de usuário origem e destino
     */
    function populateUsuarioSelects() {
      const options = migrationState.usuarios.map(user =>
        `<option value="${user.id}">${user.nome} (@${user.username})</option>`
      ).join('');

      elements.selectUsuarioOrigem.html(
        '<option value="" selected disabled>Selecione o usuário...</option>' + options
      );
      elements.selectUsuarioDestino.html(
        '<option value="" selected disabled>Selecione o usuário...</option>' + options
      );
    }

    // =====================================
    // NAVEGAÇÃO ENTRE STEPS
    // =====================================

    /**
     * Navega para um step específico
     */
    function goToStep(stepNumber) {
      migrationState.currentStep = stepNumber;

      // Ocultar todos os steps
      $('.step-content').addClass('d-none');

      // Mostrar step atual
      $(`#migration-step-${stepNumber}`).removeClass('d-none');

      // Atualizar indicadores visuais
      updateStepIndicators(stepNumber);

      // Controlar botões
      updateNavigationButtons(stepNumber);

      // Executar ações específicas do step
      onStepEnter(stepNumber);
    }

    /**
     * Atualiza indicadores visuais dos steps
     */
    function updateStepIndicators(currentStep) {
      for (let i = 1; i <= 3; i++) {
        const indicator = $(`#step-indicator-${i} .step-circle`);

        if (i < currentStep) {
          indicator.removeClass('bg-primary bg-secondary').addClass('bg-success completed');
          indicator.html('<i data-feather="check"></i>');
        } else if (i === currentStep) {
          indicator.removeClass('bg-secondary bg-success completed').addClass('bg-primary active');
          indicator.html(`<span class="fw-bold">${i}</span>`);
        } else {
          indicator.removeClass('bg-primary bg-success active completed').addClass('bg-secondary');
          indicator.html(`<span class="fw-bold">${i}</span>`);
        }
      }

      // Re-renderizar ícones Feather
      if (typeof feather !== 'undefined') {
        feather.replace();
      }
    }

    /**
     * Atualiza botões de navegação
     */
    function updateNavigationButtons(stepNumber) {
      // Botão Voltar
      elements.btnVoltar.prop('disabled', stepNumber === 1);

      // Botão Próximo
      if (stepNumber === 3) {
        elements.btnProximo.addClass('d-none');
        elements.btnExecutar.removeClass('d-none');
      } else {
        elements.btnProximo.removeClass('d-none');
        elements.btnExecutar.addClass('d-none');
      }
    }

    /**
     * Ações ao entrar em cada step
     */
    function onStepEnter(stepNumber) {
      switch(stepNumber) {
        case 1:
          // Nada específico
          break;
        case 2:
          loadClientesOrigem();
          break;
        case 3:
          validateAndShowSummary();
          break;
      }
    }

    // =====================================
    // STEP 1: SELEÇÃO DE USUÁRIOS
    // =====================================

    elements.btnProximo.on('click', function() {
      if (migrationState.currentStep === 1) {
        // Validar seleção de usuários
        const origemId = elements.selectUsuarioOrigem.val();
        const destinoId = elements.selectUsuarioDestino.val();

        if (!origemId || !destinoId) {
          showWarning('Por favor, selecione ambos os usuários (origem e destino).');
          return;
        }

        if (origemId === destinoId) {
          showWarning('Usuário de origem e destino não podem ser iguais.');
          return;
        }

        migrationState.usuarioOrigemId = parseInt(origemId);
        migrationState.usuarioDestinoId = parseInt(destinoId);

        // Avançar para step 2
        goToStep(2);
      } else if (migrationState.currentStep === 2) {
        // Validar seleção de clientes
        if (migrationState.clientesSelecionados.length === 0) {
          showWarning('Por favor, selecione pelo menos um cliente para migrar.');
          return;
        }

        // Avançar para step 3
        goToStep(3);
      }
    });

    elements.btnVoltar.on('click', function() {
      if (migrationState.currentStep > 1) {
        goToStep(migrationState.currentStep - 1);
      }
    });

    // =====================================
    // STEP 2: SELEÇÃO DE CLIENTES
    // =====================================

    /**
     * Carrega clientes do usuário origem
     */
    function loadClientesOrigem() {
      showLoading('Carregando clientes...');

      $.ajax({
        url: '/migration/clientes/list/',
        method: 'GET',
        data: { usuario_origem_id: migrationState.usuarioOrigemId },
        dataType: 'json',
        success: function(response) {
          hideLoading();

          if (response.success && response.clientes) {
            migrationState.allClientes = response.clientes;
            initializeDataTable(response.clientes);
            populateFilters(response.clientes);
          } else {
            showError('Erro ao carregar clientes: ' + (response.error || 'Resposta inválida'));
          }
        },
        error: function(xhr) {
          hideLoading();
          showError('Erro ao buscar clientes: ' + getErrorMessage(xhr));
        }
      });
    }

    /**
     * Inicializa DataTable com os clientes
     */
    function initializeDataTable(clientes) {
      // Destruir DataTable anterior se existir
      if (migrationState.dataTable) {
        migrationState.dataTable.destroy();
        elements.tableClientes.find('tbody').empty();
      }

      // Popular tbody
      const tbody = elements.tableClientes.find('tbody');
      clientes.forEach(cliente => {
        const statusClass = cliente.status === 'Ativo' ? 'success' : 'danger';
        const row = `
          <tr data-cliente-id="${cliente.id}">
            <td class="text-center">
              <input type="checkbox" class="form-check-input cliente-checkbox" value="${cliente.id}">
            </td>
            <td>${cliente.nome}</td>
            <td>${cliente.telefone}</td>
            <td>${cliente.servidor}</td>
            <td>${cliente.plano} <small class="text-muted">(R$ ${cliente.plano_valor.toFixed(2)})</small></td>
            <td><span class="badge bg-${statusClass}">${cliente.status}</span></td>
            <td>${cliente.uf}</td>
            <td>${cliente.data_cadastro}</td>
          </tr>
        `;
        tbody.append(row);
      });

      // Inicializar DataTable
      migrationState.dataTable = elements.tableClientes.DataTable({
        language: {
          url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/pt-BR.json'
        },
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "Todos"]],
        order: [[1, 'asc']], // Ordenar por nome
        columnDefs: [
          { orderable: false, targets: 0 }, // Checkbox não ordenável
        ],
        drawCallback: function() {
          // Re-aplicar estado dos checkboxes após redesenhar
          updateCheckboxStates();
        }
      });

      // Event listeners para checkboxes
      setupCheckboxListeners();
    }

    /**
     * Configura listeners para checkboxes de seleção
     */
    function setupCheckboxListeners() {
      // Checkbox "Selecionar Todos"
      elements.checkboxSelectAll.off('change').on('change', function() {
        const isChecked = $(this).is(':checked');
        elements.tableClientes.find('.cliente-checkbox:visible').prop('checked', isChecked);
        updateSelectedClientes();
      });

      // Checkboxes individuais
      elements.tableClientes.on('change', '.cliente-checkbox', function() {
        updateSelectedClientes();

        // Atualizar checkbox "Selecionar Todos"
        const totalVisible = elements.tableClientes.find('.cliente-checkbox:visible').length;
        const totalChecked = elements.tableClientes.find('.cliente-checkbox:visible:checked').length;
        elements.checkboxSelectAll.prop('checked', totalVisible === totalChecked && totalVisible > 0);
      });

      // Botões de seleção rápida
      elements.btnSelecionarTodos.off('click').on('click', function() {
        migrationState.clientesSelecionados = migrationState.allClientes.map(c => c.id);
        updateCheckboxStates();
        updateBadge();
      });

      elements.btnLimparSelecao.off('click').on('click', function() {
        migrationState.clientesSelecionados = [];
        updateCheckboxStates();
        updateBadge();
      });
    }

    /**
     * Atualiza lista de clientes selecionados
     */
    function updateSelectedClientes() {
      migrationState.clientesSelecionados = [];
      elements.tableClientes.find('.cliente-checkbox:checked').each(function() {
        migrationState.clientesSelecionados.push(parseInt($(this).val()));
      });
      updateBadge();
    }

    /**
     * Atualiza estado visual dos checkboxes
     */
    function updateCheckboxStates() {
      elements.tableClientes.find('.cliente-checkbox').each(function() {
        const clienteId = parseInt($(this).val());
        $(this).prop('checked', migrationState.clientesSelecionados.includes(clienteId));
      });
      updateBadge();
    }

    /**
     * Atualiza badge de contagem
     */
    function updateBadge() {
      const count = migrationState.clientesSelecionados.length;
      elements.badgeClientesSelecionados.text(`${count} cliente${count !== 1 ? 's' : ''} selecionado${count !== 1 ? 's' : ''}`);
    }

    /**
     * Popula filtros com dados dos clientes
     */
    function populateFilters(clientes) {
      // Extrair valores únicos
      const servidores = [...new Set(clientes.map(c => c.servidor))].sort();
      const planos = [...new Set(clientes.map(c => c.plano))].sort();
      const ufs = [...new Set(clientes.map(c => c.uf).filter(uf => uf && uf !== '-'))].sort();

      // Popular selects
      elements.filtroServidor.html(
        '<option value="">Todos</option>' +
        servidores.map(s => `<option value="${s}">${s}</option>`).join('')
      );

      elements.filtroPlano.html(
        '<option value="">Todos</option>' +
        planos.map(p => `<option value="${p}">${p}</option>`).join('')
      );

      elements.filtroUF.html(
        '<option value="">Todos</option>' +
        ufs.map(uf => `<option value="${uf}">${uf}</option>`).join('')
      );

      // Event listeners para filtros
      elements.filtroStatus.off('change').on('change', applyFilters);
      elements.filtroServidor.off('change').on('change', applyFilters);
      elements.filtroPlano.off('change').on('change', applyFilters);
      elements.filtroUF.off('change').on('change', applyFilters);
    }

    /**
     * Aplica filtros na DataTable
     */
    function applyFilters() {
      if (!migrationState.dataTable) return;

      const statusFilter = elements.filtroStatus.val();
      const servidorFilter = elements.filtroServidor.val();
      const planoFilter = elements.filtroPlano.val();
      const ufFilter = elements.filtroUF.val();

      // Aplicar filtros por coluna
      migrationState.dataTable
        .column(5).search(statusFilter) // Status
        .column(3).search(servidorFilter) // Servidor
        .column(4).search(planoFilter, true, false) // Plano (regex)
        .column(6).search(ufFilter) // UF
        .draw();
    }

    // =====================================
    // STEP 3: VALIDAÇÃO E CONFIRMAÇÃO
    // =====================================

    /**
     * Valida migração e exibe resumo
     */
    function validateAndShowSummary() {
      showLoading('Validando migração...');

      $.ajax({
        url: '/migration/clientes/validate/',
        method: 'POST',
        contentType: 'application/json',
        headers: {
          'X-CSRFToken': csrftoken
        },
        data: JSON.stringify({
          usuario_origem_id: migrationState.usuarioOrigemId,
          usuario_destino_id: migrationState.usuarioDestinoId,
          clientes_ids: migrationState.clientesSelecionados
        }),
        dataType: 'json',
        success: function(response) {
          hideLoading();

          if (response.success) {
            migrationState.validationResult = response;
            displaySummary(response);
          } else {
            showError('Erro na validação:\n' + (response.error || 'Erro desconhecido'));
            // Voltar para step 2
            goToStep(2);
          }
        },
        error: function(xhr) {
          hideLoading();
          const errorMsg = getErrorMessage(xhr);

          // Tentar extrair erros de validação
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.validation_errors && response.validation_errors.length > 0) {
              showValidationErrors(response.validation_errors);
              goToStep(2);
              return;
            }
          } catch(e) {}

          showError('Erro ao validar migração: ' + errorMsg);
          goToStep(2);
        }
      });
    }

    /**
     * Exibe resumo da validação
     */
    function displaySummary(response) {
      const validation = response.validation;
      const stats = validation.stats;

      // Usuários
      $('#resumo-usuario-origem').text(response.usuario_origem.nome);
      $('#resumo-usuario-destino').text(response.usuario_destino.nome);

      // Totais
      $('#resumo-total-clientes').text(validation.clientes_count);
      $('#resumo-mensalidades').text(stats.mensalidades || 0);
      $('#resumo-contas-app').text(stats.contas_aplicativo || 0);
      $('#resumo-historicos').text(stats.historico_planos || 0);

      // Warnings
      if (validation.warnings && validation.warnings.length > 0) {
        $('#warnings-container').removeClass('d-none');
        const warningsList = $('#warnings-list');
        warningsList.empty();
        validation.warnings.forEach(warning => {
          warningsList.append(`<li>${warning}</li>`);
        });
      } else {
        $('#warnings-container').addClass('d-none');
      }

      // Entidades a criar
      const entitiesToCreate = validation.entities_to_create;
      const hasEntities = Object.keys(entitiesToCreate).length > 0;

      if (hasEntities) {
        $('#entities-container').removeClass('d-none');
        const entitiesList = $('#entities-list');
        entitiesList.empty();

        for (const [entityType, entities] of Object.entries(entitiesToCreate)) {
          if (entities.length > 0) {
            const names = entities.map(e => e.nome).join(', ');
            entitiesList.append(`
              <div class="mb-2">
                <strong>${entityType}:</strong> ${names}
              </div>
            `);
          }
        }
      } else {
        $('#entities-container').addClass('d-none');
      }
    }

    /**
     * Exibe erros de validação em modal
     */
    function showValidationErrors(errors) {
      const errorList = errors.map(err => `<li>${err}</li>`).join('');
      Swal.fire({
        icon: 'error',
        title: 'Erros de Validação',
        html: `
          <div class="text-start">
            <p>Os seguintes erros foram encontrados:</p>
            <ul class="small">${errorList}</ul>
          </div>
        `,
        confirmButtonText: 'Entendi',
        customClass: {
          confirmButton: 'btn btn-primary'
        }
      });
    }

    // =====================================
    // EXECUÇÃO DA MIGRAÇÃO
    // =====================================

    elements.btnExecutar.on('click', function() {
      confirmAndExecuteMigration();
    });

    /**
     * Confirma e executa migração
     */
    function confirmAndExecuteMigration() {
      const count = migrationState.clientesSelecionados.length;

      Swal.fire({
        icon: 'warning',
        title: 'Confirmar Migração',
        html: `
          <p>Você está prestes a migrar <strong>${count} cliente${count !== 1 ? 's' : ''}</strong>.</p>
          <p class="text-danger"><strong>Esta operação é irreversível!</strong></p>
          <p>Deseja continuar?</p>
        `,
        showCancelButton: true,
        confirmButtonText: 'Sim, migrar!',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        reverseButtons: true
      }).then((result) => {
        if (result.isConfirmed) {
          executeMigration();
        }
      });
    }

    /**
     * Executa a migração
     */
    function executeMigration() {
      showLoading('Executando migração...<br><small class="text-muted">Por favor, aguarde...</small>');

      $.ajax({
        url: '/migration/clientes/execute/',
        method: 'POST',
        contentType: 'application/json',
        headers: {
          'X-CSRFToken': csrftoken
        },
        data: JSON.stringify({
          usuario_origem_id: migrationState.usuarioOrigemId,
          usuario_destino_id: migrationState.usuarioDestinoId,
          clientes_ids: migrationState.clientesSelecionados
        }),
        dataType: 'json',
        success: function(response) {
          hideLoading();

          if (response.success) {
            showSuccess(response);
          } else {
            showError('Erro ao executar migração: ' + (response.error || 'Erro desconhecido'));
          }
        },
        error: function(xhr) {
          hideLoading();
          showError('Erro ao executar migração: ' + getErrorMessage(xhr));
        }
      });
    }

    /**
     * Exibe mensagem de sucesso
     */
    function showSuccess(response) {
      const stats = response.result.stats;

      Swal.fire({
        icon: 'success',
        title: 'Migração Concluída!',
        html: `
          <div class="text-start">
            <p class="mb-3">${response.message}</p>
            <h6>Estatísticas:</h6>
            <ul class="small">
              <li>Clientes migrados: <strong>${stats.clientes_migrados}</strong></li>
              <li>Mensalidades migradas: <strong>${stats.mensalidades_migradas}</strong></li>
              <li>Contas migradas: <strong>${stats.contas_migradas}</strong></li>
              <li>Históricos migrados: <strong>${stats.historicos_migrados}</strong></li>
            </ul>
          </div>
        `,
        confirmButtonText: 'Fechar',
        customClass: {
          confirmButton: 'btn btn-success'
        }
      }).then(() => {
        elements.modal.modal('hide');
        // Reload da página para atualizar dados
        if (typeof location !== 'undefined') {
          location.reload();
        }
      });
    }

    // =====================================
    // HELPERS E UTILITÁRIOS
    // =====================================

    /**
     * Exibe estado de loading
     */
    function showLoading(message) {
      $('.step-content').addClass('d-none');
      $('#migration-loading').removeClass('d-none');
      $('#loading-message').html(message || 'Processando...');

      // Desabilitar botões
      elements.btnProximo.prop('disabled', true);
      elements.btnVoltar.prop('disabled', true);
      elements.btnExecutar.prop('disabled', true);
    }

    /**
     * Oculta estado de loading
     */
    function hideLoading() {
      $('#migration-loading').addClass('d-none');

      // Mostrar step atual novamente
      $(`#migration-step-${migrationState.currentStep}`).removeClass('d-none');

      // Reabilitar botões
      elements.btnProximo.prop('disabled', false);
      elements.btnVoltar.prop('disabled', migrationState.currentStep === 1);
      elements.btnExecutar.prop('disabled', false);
    }

    /**
     * Exibe mensagem de erro
     */
    function showError(message) {
      Swal.fire({
        icon: 'error',
        title: 'Erro',
        text: message,
        confirmButtonText: 'OK',
        customClass: {
          confirmButton: 'btn btn-danger'
        }
      });
    }

    /**
     * Exibe mensagem de aviso
     */
    function showWarning(message) {
      Swal.fire({
        icon: 'warning',
        title: 'Atenção',
        text: message,
        confirmButtonText: 'OK',
        customClass: {
          confirmButton: 'btn btn-warning'
        }
      });
    }

    /**
     * Extrai mensagem de erro de resposta AJAX
     */
    function getErrorMessage(xhr) {
      try {
        const response = JSON.parse(xhr.responseText);
        return response.error || response.message || 'Erro desconhecido';
      } catch(e) {
        return xhr.statusText || 'Erro de comunicação com o servidor';
      }
    }

    // =====================================
    // CLEANUP AO FECHAR MODAL
    // =====================================

    elements.modal.on('hidden.bs.modal', function() {
      // Destruir DataTable
      if (migrationState.dataTable) {
        migrationState.dataTable.destroy();
        migrationState.dataTable = null;
      }

      // Resetar filtros
      elements.filtroStatus.val('');
      elements.filtroServidor.val('');
      elements.filtroPlano.val('');
      elements.filtroUF.val('');
    });

    // Re-renderizar ícones Feather quando modal abre
    elements.modal.on('shown.bs.modal', function() {
      if (typeof feather !== 'undefined') {
        feather.replace();
      }
    });
  });
});
