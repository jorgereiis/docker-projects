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
  $(function () {
    const modal = $('#userLogsModal');
    if (!modal.length) {
      return;
    }

    const tableBody = $('#userLogsTable tbody');
    const actionSelect = $('#userLogsAction');
    const userSelect = $('#userLogsUser');
    const userWrapper = $('#userLogsUserWrapper');
    const limitSelect = $('#userLogsLimit');
    const searchInput = $('#userLogsSearch');
    const sinceInput = $('#userLogsSince');
    const untilInput = $('#userLogsUntil');
    const feedback = $('#userLogsFeedback');
    const summary = $('#userLogsSummary');
    const refreshBtn = $('#userLogsRefresh');
    const clearBtn = $('#userLogsClearFilters');

    const SPINNER_ROW = '<tr><td colspan="7" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Carregando logs...</td></tr>';
    const EMPTY_ROW = '<tr><td colspan="7" class="text-center py-4 text-muted">Nenhum registro localizado para os filtros informados.</td></tr>';

    let actionsLoaded = false;
    let usersLoaded = false;
    let currentRequest = null;

    function showFeedback(message, type = 'info') {
      feedback.removeClass('d-none alert-info alert-warning alert-danger alert-success')
        .addClass(`alert-${type}`)
        .text(message);
    }

    function hideFeedback() {
      feedback.addClass('d-none');
    }

    function setLoading(isLoading) {
      if (isLoading) {
        tableBody.html(SPINNER_ROW);
        refreshBtn.prop('disabled', true);
      } else {
        refreshBtn.prop('disabled', false);
      }
    }

    function resetSummary() {
      summary.text('');
    }

    function populateActions(actions) {
      if (actionsLoaded || !Array.isArray(actions)) {
        return;
      }
      const fragment = document.createDocumentFragment();
      actions.forEach(action => {
        const option = document.createElement('option');
        option.value = action.value;
        option.textContent = action.label;
        fragment.appendChild(option);
      });
      actionSelect.append(fragment);
      actionsLoaded = true;
    }

    function populateUsers(users, selectedUserId, canViewAll) {
      if (!canViewAll) {
        userWrapper.addClass('d-none');
        return;
      }

      userWrapper.removeClass('d-none');
      if (usersLoaded || !Array.isArray(users)) {
        if (selectedUserId) {
          userSelect.val(String(selectedUserId));
        }
        return;
      }

      const fragment = document.createDocumentFragment();
      users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.nome !== user.username
          ? `${user.nome} (${user.username})`
          : user.username;
        fragment.appendChild(option);
      });
      userSelect.append(fragment);
      if (selectedUserId) {
        userSelect.val(String(selectedUserId));
      }
      usersLoaded = true;
    }

    function formatExtras(extras) {
      if (!extras || (typeof extras === 'object' && Object.keys(extras).length === 0)) {
        return $('<span/>').addClass('text-muted').text('—');
      }
      try {
        const serialized = JSON.stringify(extras, null, 2);
        return $('<pre/>')
          .addClass('mb-0 small bg-light border rounded p-2 text-break')
          .text(serialized);
      } catch (err) {
        return $('<span/>').text(String(extras));
      }
    }

    function buildRow(log) {
      const tr = $('<tr/>');
      $('<td/>').text(log.timestamp || '—').appendTo(tr);

      const usuario = log.usuario || {};
      const usuarioTexto = usuario.nome && usuario.nome !== usuario.username
        ? `${usuario.nome} (${usuario.username})`
        : (usuario.username || '—');
      $('<td/>').text(usuarioTexto).appendTo(tr);

      const acaoCell = $('<td/>');
      acaoCell.append($('<span/>').addClass('badge bg-primary-subtle text-primary-emphasis').text(log.acao_label || log.acao || '—'));
      tr.append(acaoCell);

      const entidadeTexto = log.entidade ? log.entidade : '—';
      const identificador = log.objeto_repr ? ` ${log.objeto_repr}` : (log.objeto_id ? ` #${log.objeto_id}` : '');
      $('<td/>').text(entidadeTexto + identificador).appendTo(tr);

      $('<td/>').text(log.mensagem || '—').appendTo(tr);

      const extrasCell = $('<td/>');
      extrasCell.append(formatExtras(log.extras));
      tr.append(extrasCell);

      const origemCell = $('<td/>').addClass('small');
      if (log.ip) {
        origemCell.append($('<div/>').text(log.ip));
      }
      if (log.request_path) {
        origemCell.append($('<div/>').addClass('text-muted').text(log.request_path));
      }
      if (!log.ip && !log.request_path) {
        origemCell.text('—');
      }
      tr.append(origemCell);

      return tr;
    }

    function collectFilters() {
      const params = {
        limit: parseInt(limitSelect.val(), 10) || 50,
      };

      const action = actionSelect.val();
      if (action) {
        params.action = action;
      }

      const userValue = userWrapper.hasClass('d-none') ? '' : userSelect.val();
      if (userValue) {
        params.user = userValue;
      }

      const searchValue = searchInput.val();
      if (searchValue) {
        params.search = searchValue;
      }

      const since = sinceInput.val();
      if (since) {
        params.since = since;
      }

      const until = untilInput.val();
      if (until) {
        params.until = until;
      }

      return params;
    }

    function fetchLogs() {
      if (currentRequest) {
        currentRequest.abort();
      }

      hideFeedback();
      resetSummary();
      setLoading(true);

      currentRequest = $.ajax({
        url: '/user-logs/',
        method: 'GET',
        data: collectFilters(),
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
        .done((response) => {
          populateActions(response.actions);
          populateUsers(response.users, response.selected_user, response.can_view_all);

          const results = Array.isArray(response.results) ? response.results : [];
          if (!results.length) {
            tableBody.html(EMPTY_ROW);
            summary.text(`0 de ${response.total || 0} registro(s).`);
            return;
          }

          const fragment = $(document.createDocumentFragment());
          results.forEach((log) => {
            fragment.append(buildRow(log));
          });
          tableBody.html(fragment);

          const total = response.total || results.length;
          summary.text(`Exibindo ${results.length} de ${total} registro(s). Limite atual: ${response.limit || ''}.`);
        })
        .fail((jqXHR, textStatus) => {
          if (textStatus === 'abort') {
            return;
          }
          tableBody.html(EMPTY_ROW);
          showFeedback('Não foi possível carregar os logs agora. Tente novamente em instantes.', 'danger');
        })
        .always(() => {
          setLoading(false);
          currentRequest = null;
        });
    }

    refreshBtn.on('click', fetchLogs);
    limitSelect.on('change', fetchLogs);
    actionSelect.on('change', fetchLogs);
    userSelect.on('change', fetchLogs);
    sinceInput.on('change', fetchLogs);
    untilInput.on('change', fetchLogs);

    searchInput.on('keypress', (event) => {
      if (event.key === 'Enter') {
        fetchLogs();
      }
    });

    clearBtn.on('click', () => {
      actionSelect.val('');
      if (!userWrapper.hasClass('d-none')) {
        userSelect.val('');
      }
      limitSelect.val('50');
      searchInput.val('');
      sinceInput.val('');
      untilInput.val('');
      fetchLogs();
    });

    $(document).on('shown.bs.modal', '#userLogsModal', () => {
      fetchLogs();
    });

    $(document).on('hidden.bs.modal', '#userLogsModal', () => {
      hideFeedback();
      resetSummary();
    });
  });
});
