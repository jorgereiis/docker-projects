function modal_dns() {
    $('#dns-modal').modal('show');
    $("#show-dns").html('<div class="text-muted">Carregando status dos DNS...</div>');

    $.ajax({
        url: "/modal-dns-json/",  // URL do endpoint JSON
        method: "GET",
        success: function(response) {
            var html = "";
            if (response.dns.length === 0) {
                html = '<div class="alert alert-warning">Nenhum domínio DNS encontrado.</div>';
            } else {
                response.dns.forEach(function(d) {
                    html += `
                    <div class="col-xl-3 col-lg-3 col-md-4 col-sm-6 col-12 mt-2 objeto">
                        <div class="card dns-card">
                            <div class="card-body">
                                <div class="d-flex justify-content-between align-items-center mb-3 objeto">
                                    <div>
                                        <h4 class="mb-0">${d.servidor.toUpperCase()}</h4>
                                    </div>
                                    ${(d.status === true || d.status === 'True' || d.status === 'true')
                                        ? (
                                            d.acesso_canais !== 'TOTAL'
                                                ? `<div class="icon-shape icon-md bg-light-warning text-warning rounded-2 d-inline-flex align-items-center justify-content-center"
                                                        title="Domínio online, mas canais com alguns canais indisponíveis.">
                                                        <i class="bi bi-exclamation-triangle fs-4"></i>
                                                </div>`
                                                : `<div class="icon-shape icon-md bg-light-primary text-primary rounded-2 d-inline-flex align-items-center justify-content-center"
                                                        title="Domínio e canais online.">
                                                        <i class="bi bi-check2-circle fs-4"></i>
                                                </div>`
                                        )
                                        : `<div class="icon-shape icon-md bg-light-danger text-danger rounded-2 d-inline-flex align-items-center justify-content-center"
                                                title="Domínio offline. Última checagem falhou.">
                                                <i class="bi bi-emoji-angry-fill fs-4"></i>
                                        </div>`
                                    }
                                </div>
                                <div class="text-center">
                                    <h3 class="fw-bold mb-1">
                                        ${(d.status === true || d.status === 'True' || d.status === 'true') ? 'ONLINE' : 'DOWN'}
                                    </h3>
                                    <span class="me-1 ms-auto dns-info-small">
                                        ${d.dominio}
                                    </span>
                                    <div class="dns-info-small text-muted mt-2">
                                        Desde: ${
                                            (d.status === true || d.status === 'True' || d.status === 'true')
                                                ? (d.data_online || '01/01/2000')
                                                : (d.data_offline || '01/01/2000')
                                        }
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    `;
                });
            }
            $("#show-dns").html(html);
        },
        error: function() {
            $("#show-dns").html('<div class="text-danger text-center">Erro ao carregar status dos DNS.</div>');
        }
    });

    // Fecha o modal ao clicar no close
    $('#dns-modal').on('click', '.btn-close, .btn-secondary', function () {
        $('#dns-modal').modal('hide');
    });
}
