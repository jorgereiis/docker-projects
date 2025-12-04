function modal_adminlogs() {
    $('#logs-modal').modal('show');
    $("#show-logs").html('<div class="text-muted">Carregando arquivos de log...</div>');
    console.log("Modal de logs aberto");
    console.log(typeof $('#logs-modal').modal);

    // Buscar lista de arquivos de log do Admin
    $.get("/logs/list/", function(response) {
        if (response.files.length === 0) {
            $("#show-logs").html('<div class="alert alert-warning">Nenhum arquivo de log encontrado.</div>');
            return;
        }
        let selectHtml = '<select id="select-log" class="form-select mb-3">';
        selectHtml += '<option value="">Selecione um arquivo de log</option>';
        response.files.forEach(function(file) {
            selectHtml += `<option value="${file}">${file}</option>`;
        });
        selectHtml += '</select><pre id="log-content" class="bg-dark text-light p-2 rounded" style="font-size: 0.96rem; max-height: 70vh; min-height: 80px; overflow:auto;"></pre>';
        $("#show-logs").html(selectHtml);

        // Ao selecionar, buscar conteúdo
        $('#select-log').on('change', function() {
            const filename = $(this).val();
            if (!filename) {
                $('#log-content').html('');
                return;
            }
            $('#log-content').html('Carregando conteúdo...');
            $.get("/logs/content/?file=" + encodeURIComponent(filename), function(res) {
                $('#log-content').html(res.content);
            }).fail(function() {
                $('#log-content').html('Erro ao carregar conteúdo do log.');
            });
        });
    });

    // Fecha o modal ao clicar no close
    $('#logs-modal').on('click', '.btn-close, .btn-secondary', function () {
        $('#logs-modal').modal('hide');
    });
}
