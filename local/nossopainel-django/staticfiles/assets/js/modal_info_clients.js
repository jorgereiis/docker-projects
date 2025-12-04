// ----------------------
// MODAL DE INFORMAÇÕES
// ----------------------

// CSRF Token para requisições AJAX - cria versão global se não existir
if (typeof window.csrfToken === 'undefined') {
    var csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
    window.csrfToken = csrfTokenMeta ? csrfTokenMeta.getAttribute('content') : '';
}
var csrfToken = window.csrfToken;

function exibirModalDetalhes(botao) {
    // Dados do cliente vindos do botão/data-attributes
    const clienteId = botao.dataset.id;
    const clienteNome = botao.dataset.nome;
    const clientePlano = botao.dataset.plano;
    const clienteTelas = botao.dataset.telas;
    const clienteTelefone = botao.dataset.telefone;
    const clienteServidor = botao.dataset.servidor;
    const clienteFormaPgto = botao.dataset.forma_pgto;
    const clienteAplicativo = botao.dataset.aplicativo;
    const clienteDataAdesao = botao.dataset.data_adesao;
    const clienteDispositivo = botao.dataset.dispositivo;
    const clienteDataVencimento = botao.dataset.data_vencimento;
    const clienteContaAplicativo = botao.dataset.conta_aplicativo;

    let clienteUltimoPagamento = botao.dataset.ultimo_pagamento;
    if (clienteUltimoPagamento == 'None' || clienteUltimoPagamento == '' || clienteUltimoPagamento == null){
        clienteUltimoPagamento = '--';
    }
    
    let clienteIndicadoPor = botao.dataset.indicado_por;
    if (clienteIndicadoPor == 'None' || clienteIndicadoPor == '' || clienteIndicadoPor == null){
        clienteIndicadoPor = '--';
    }
    
    let clienteNotas = botao.dataset.notas;
    if (clienteNotas == 'None' || clienteNotas == '' || clienteNotas == null){
        clienteNotas = '--';
    }
    
    const table = document.querySelector("#info-cliente-table");

    // Atualiza campos no modal
    document.getElementById('info-cliente-id').textContent = clienteId;
    document.getElementById('info-cliente-tela').textContent = clienteTelas;
    document.getElementById('info-cliente-nome').textContent = clienteNome;
    document.getElementById('info-cliente-notas').textContent =  clienteNotas;
    document.getElementById('info-cliente-plano').textContent =  clientePlano;
    document.getElementById('info-cliente-servidor').textContent =  clienteServidor;
    document.getElementById('info-cliente-forma_pgto').textContent =  clienteFormaPgto;
    document.getElementById('info-cliente-aplicativo').textContent =  clienteAplicativo;
    document.getElementById('info-cliente-dispositivo').textContent =  clienteDispositivo;
    document.getElementById('info-cliente-indicado_por').textContent =  clienteIndicadoPor;
    document.getElementById('info-cliente-ultimo_pgto').textContent =  clienteUltimoPagamento;
    document.getElementById('info-cliente-data_vencimento').textContent =  clienteDataVencimento;
    document.getElementById('info-cliente-telefone').textContent = clienteTelefone;
    document.getElementById('info-cliente-data_adesao').textContent = 'Cliente desde ' + clienteDataAdesao;

    $('#info-cliente-modal').modal('show');

    // AJAX: carregar cards de contas do app, resumo e indicações
    carregarContasApps(clienteId);
    carregarQuantidadeMensalidadesPagas(clienteId);
    carregarIndicacoes(clienteId);
}

// Fecha modal de informações quando necessário
$('#info-cliente-modal').on('click', '.btn-close, .btn-secondary, #add-apps-info', function () {
    $('#info-cliente-modal').modal('hide');
}); 

// Carregar informações de quantidade de mensalidades pagas
function carregarQuantidadeMensalidadesPagas(clienteId) {
    $.ajax({
        url: '/qtds-mensalidades/',
        type: 'GET',
        data: { cliente_id: clienteId },
        success: function(data) {
            var elemPagas = document.getElementById('qtd_mensalidades_pagas');
            var elemPendentes = document.getElementById('qtd_mensalidades_pendentes');
            var elemCanceladas = document.getElementById('qtd_mensalidades_canceladas');

            if (elemPagas) elemPagas.textContent = data.qtd_mensalidades_pagas;
            if (elemPendentes) elemPendentes.textContent = data.qtd_mensalidades_pendentes;
            if (elemCanceladas) elemCanceladas.textContent = data.qtd_mensalidades_canceladas;

            var tbody = document.querySelector('#table-invoice tbody');
            tbody.innerHTML = '';

            // Função única para formatar datas
            function formatarData(data) {
                if (!data) return '-';
                var partes = data.split('-');
                if (partes.length !== 3) return data;
                return partes[2] + '/' + partes[1] + '/' + partes[0];
            }

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            data.mensalidades_totais.forEach(function(mensalidade) {
                var tr = document.createElement('tr');

                // ID
                var tdId = document.createElement('td');
                tdId.textContent = mensalidade.id;
                tr.appendChild(tdId);

                // Status
                var tdStatus = document.createElement('td');
                tdStatus.className = 'text-center'; // Centralizar

                var vencimentoJS = new Date(mensalidade.dt_vencimento);

                // Container flex para múltiplos badges
                var badgeContainer = document.createElement('div');
                badgeContainer.className = 'd-flex gap-1 align-items-center justify-content-center flex-wrap';

                // Badge de status (Pago/Cancelado/Inadimplente/Em aberto)
                var statusBadge = document.createElement('span');
                statusBadge.className = 'badge rounded-pill pill-invoice-small';

                if (mensalidade.pgto) {
                    statusBadge.classList.add('bg-success');
                    statusBadge.innerHTML = '<i class="bi bi-check-circle"></i> Pago';
                } else if (mensalidade.cancelado) {
                    statusBadge.classList.add('bg-warning');
                    statusBadge.innerHTML = '<i class="bi bi-x-square"></i> Cancelado';
                } else if (vencimentoJS < hoje) {
                    statusBadge.classList.add('bg-danger');
                    statusBadge.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Inadimplente';
                } else {
                    statusBadge.classList.add('bg-secondary');
                    statusBadge.innerHTML = '<i class="bi bi-clock"></i> Em aberto';
                }

                badgeContainer.appendChild(statusBadge);

                // ⭐ FASE 2.5: Badge de CAMPANHA / REGULAR com rastreamento preciso
                if (mensalidade.dados_historicos_verificados) {
                    // Dados PRECISOS (mensalidades novas - após implementação do rastreamento)
                    if (mensalidade.gerada_em_campanha) {
                        // Mensalidade foi gerada durante uma campanha
                        var campanhaBadge = document.createElement('span');
                        campanhaBadge.className = 'badge rounded-pill bg-warning-subtle text-warning border border-warning pill-invoice-small';
                        campanhaBadge.innerHTML = '<i class="bi bi-megaphone-fill"></i> Campanha';
                        badgeContainer.appendChild(campanhaBadge);
                    } else {
                        // Mensalidade foi gerada em plano regular
                        var regularBadge = document.createElement('span');
                        regularBadge.className = 'badge rounded-pill bg-secondary-subtle text-secondary border border-secondary pill-invoice-small';
                        regularBadge.innerHTML = '<i class="bi bi-check-circle-fill"></i> Regular';
                        badgeContainer.appendChild(regularBadge);
                    }
                } else {
                    // Dados ESTIMADOS (mensalidades antigas - antes da implementação)
                    // Mostrar badge neutro indicando que é dado histórico
                    var historicoBadge = document.createElement('span');
                    historicoBadge.className = 'badge rounded-pill bg-light text-dark border pill-invoice-small';
                    historicoBadge.innerHTML = '<i class="bi bi-clock-history"></i> Histórico';
                    historicoBadge.title = 'Dado estimado (mensalidade anterior ao sistema de rastreamento)';
                    badgeContainer.appendChild(historicoBadge);
                }

                tdStatus.appendChild(badgeContainer);
                tr.appendChild(tdStatus);

                // Vencimento
                var tdVencimento = document.createElement('td');
                tdVencimento.textContent = formatarData(mensalidade.dt_vencimento);
                tr.appendChild(tdVencimento);

                // Valor
                var tdValor = document.createElement('td');
                tdValor.textContent = 'R$ ' + Number(mensalidade.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                tr.appendChild(tdValor);

                // Pagamento
                var tdPagamento = document.createElement('td');
                tdPagamento.textContent = mensalidade.dt_pagamento ? formatarData(mensalidade.dt_pagamento) : '-';
                tr.appendChild(tdPagamento);

                tbody.appendChild(tr);
            });
        },
        error: function(error) {
            console.log(error);
        }
    });
}

// Carregar informações de indicações do cliente
function carregarIndicacoes(clienteId) {
    $.ajax({
        url: '/indicacoes/',
        type: 'GET',
        data: { cliente_id: clienteId },
        success: function(data) {
            var tbody = document.querySelector('#table-indicados tbody');
            tbody.innerHTML = '';

            // Função única para formatação
            function formatarData(data) {
                if (!data) return '--';
                var partes = data.split('-');
                if (partes.length !== 3) return data;
                return partes[2] + '/' + partes[1] + '/' + partes[0];
            }

            // Garante array
            var indicacoes = Array.isArray(data.indicacoes) ? data.indicacoes : [];

            // Atualizar card de desconto progressivo
            var descontoInfo = data.desconto_progressivo || {};
            var cardDesconto = document.getElementById('card-desconto-progressivo');

            if (descontoInfo.ativo && descontoInfo.valor_total > 0) {
                // Exibir card
                cardDesconto.style.display = 'block';

                // Atualizar valores
                document.getElementById('desconto-total-valor').textContent =
                    'R$ ' + descontoInfo.valor_total.toFixed(2).replace('.', ',');

                var limiteText = descontoInfo.limite_indicacoes > 0
                    ? descontoInfo.qtd_descontos_ativos + '/' + descontoInfo.limite_indicacoes
                    : descontoInfo.qtd_descontos_ativos + ' (ilimitado)';
                document.getElementById('desconto-qtd-indicacoes').textContent = limiteText;

                document.getElementById('desconto-qtd-aplicados').textContent = descontoInfo.qtd_descontos_aplicados;
            } else {
                // Ocultar card
                cardDesconto.style.display = 'none';
            }

            if (indicacoes.length === 0) {
                // Não há indicações
                var tr = document.createElement('tr');
                var tdMensagem = document.createElement('td');
                tdMensagem.setAttribute('colspan', '5');
                tdMensagem.textContent = 'Não há indicações desse usuário!';
                tdMensagem.style.textAlign = 'center';
                tdMensagem.style.verticalAlign = 'middle';
                tr.appendChild(tdMensagem);
                tbody.appendChild(tr);
            } else {
                indicacoes.forEach(function(indicado) {
                    var tr = document.createElement('tr');

                    var tdId = document.createElement('td');
                    tdId.textContent = indicado.id != null ? indicado.id : '--';
                    tr.appendChild(tdId);

                    // Status (Ativo/Cancelado)
                    var tdStatus = document.createElement('td');
                    if (indicado.cancelado) {
                        tdStatus.innerHTML = '<span class="badge bg-danger">Cancelado</span>';
                    } else {
                        tdStatus.innerHTML = '<span class="badge bg-success">Ativo</span>';
                    }
                    tr.appendChild(tdStatus);

                    var tdNome = document.createElement('td');
                    tdNome.textContent = indicado.nome != null ? indicado.nome : '--';
                    tr.appendChild(tdNome);

                    var tdAdesao = document.createElement('td');
                    tdAdesao.textContent = formatarData(indicado.data_adesao);
                    tr.appendChild(tdAdesao);

                    // Coluna de desconto - ícones para indicar se gera desconto ativo
                    var tdDesconto = document.createElement('td');
                    tdDesconto.className = 'text-center';

                    if (descontoInfo.ativo && indicado.tem_desconto_ativo) {
                        // Ícone verde - gera desconto ativo
                        var iconGreen = document.createElement('i');
                        iconGreen.className = 'bi bi-check-circle-fill text-success';
                        iconGreen.style.fontSize = '1.25rem';
                        iconGreen.style.display = 'inline-block';
                        iconGreen.title = 'Gera desconto ativo';
                        tdDesconto.appendChild(iconGreen);
                    } else {
                        // Ícone cinza - sem desconto
                        var iconGray = document.createElement('i');
                        iconGray.className = 'bi bi-dash-circle text-muted';
                        iconGray.style.fontSize = '1.25rem';
                        iconGray.style.display = 'inline-block';
                        iconGray.title = 'Sem desconto';
                        tdDesconto.appendChild(iconGray);
                    }
                    tr.appendChild(tdDesconto);

                    tbody.appendChild(tr);
                });
            }
        },
        error: function(error) {
            // Exibe erro na tabela
            var tbody = document.querySelector('#table-indicados tbody');
            if (tbody) {
                tbody.innerHTML = '';
                var tr = document.createElement('tr');
                var tdErro = document.createElement('td');
                tdErro.setAttribute('colspan', '5');
                tdErro.textContent = 'Erro ao carregar indicações!';
                tdErro.style.textAlign = 'center';
                tdErro.style.color = 'red';
                tr.appendChild(tdErro);
                tbody.appendChild(tr);
            }
            console.log('Indicacoes: ', error);
        }
    });
}


// ----------------------
// CARDS CONTAS DE APP
// ----------------------

function carregarContasApps(clienteId) {
    $.ajax({
        url: '/contas-apps/',
        type: 'GET',
        data: { cliente_id: clienteId },
        success: function(data) {
            let container = $('.dados-apps');
            let container2 = $('.texto-aqui');
            container.empty();
            container2.empty();

            let contas = Array.isArray(data.conta_app) ? data.conta_app : [];

            if (contas.length === 0) {
                container2.append('<p class="text-muted text-center">Ainda não há contas de aplicativo para esse cliente.</p>');
                return;
            }

            contas.forEach(function(conta) {
                // Sanitizar valores para evitar problemas com aspas
                const contaId = conta.id != null ? conta.id : '';
                const nomeApp = conta.nome_aplicativo != null ? conta.nome_aplicativo : '--';
                const nomeDispositivo = conta.nome_dispositivo != null ? conta.nome_dispositivo : 'Não especificado';
                const logoUrl = conta.logo_url || '/static/assets/images/logo-apps/default.png';

                // Determinar qual informação primária exibir (Device ID ou Email)
                const hasDeviceId = conta.device_id && conta.device_id.trim() !== '';
                const hasEmail = conta.email && conta.email.trim() !== '';
                const hasDeviceKey = conta.device_key && conta.device_key !== 'null' && String(conta.device_key).trim() !== "";

                // Construir HTML do card moderno
                let cardHtml = `
                    <div class="app-card-modern" data-app-id="${contaId}">
                        <div class="app-card-content">
                            <!-- Logo -->
                            <img src="${logoUrl}"
                                 alt="${nomeApp} Logo"
                                 class="app-card-logo">

                            <!-- Badge Principal (acima do título) -->
                            ${conta.is_principal ? '<span class="badge bg-warning text-dark" style="font-size: 0.6rem; padding: 0.25rem 0.5rem; display: inline-block;"><i class="bi bi-star-fill me-1"></i>Principal</span>' : ''}

                            <!-- Título -->
                            <h3 class="app-card-title">
                                ${nomeApp}
                            </h3>

                            <!-- Dispositivo abaixo -->
                            <p class="app-card-device">${nomeDispositivo}</p>

                            <!-- Informações técnicas -->
                            <div class="app-card-info">
                `;

                // Device ID ou Email
                if (hasDeviceId) {
                    const deviceIdSafe = String(conta.device_id).replace(/'/g, "\\'");
                    cardHtml += `
                        <div class="app-card-info-item">
                            <span class="app-card-info-label">Device ID</span>
                            <div class="app-card-info-value-wrapper">
                                <span class="app-card-info-value">${conta.device_id}</span>
                                <button class="app-card-copy-btn"
                                        onclick="copiarParaClipboard(this, '${deviceIdSafe}')"
                                        title="Copiar Device ID"
                                        type="button">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                        </div>
                    `;
                } else if (hasEmail) {
                    const emailSafe = String(conta.email).replace(/'/g, "\\'");
                    cardHtml += `
                        <div class="app-card-info-item">
                            <span class="app-card-info-label">E-mail</span>
                            <div class="app-card-info-value-wrapper">
                                <span class="app-card-info-value">${conta.email}</span>
                                <button class="app-card-copy-btn"
                                        onclick="copiarParaClipboard(this, '${emailSafe}')"
                                        title="Copiar E-mail"
                                        type="button">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }

                // Device Key (se houver)
                if (hasDeviceKey) {
                    const deviceKeySafe = String(conta.device_key).replace(/'/g, "\\'");
                    cardHtml += `
                        <div class="app-card-info-item">
                            <span class="app-card-info-label">Device Key</span>
                            <div class="app-card-info-value-wrapper">
                                <span class="app-card-info-value">${conta.device_key}</span>
                                <button class="app-card-copy-btn"
                                        onclick="copiarParaClipboard(this, '${deviceKeySafe}')"
                                        title="Copiar Device Key"
                                        type="button">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }

                // Se NÃO houver nenhuma credencial, exibir mensagem
                if (!hasDeviceId && !hasEmail && !hasDeviceKey) {
                    cardHtml += `
                        <div class="app-card-info-item">
                            <div class="app-card-no-account">
                                <i class="bi bi-info-circle"></i>
                                <span>Aplicativo sem conta cadastrada</span>
                            </div>
                        </div>
                    `;
                }

                // Fechar seção de info e adicionar botão deletar
                cardHtml += `
                            </div>

                            <!-- Botão deletar -->
                            <button class="app-card-delete-btn"
                                    data-app-id="${contaId}"
                                    title="Deletar conta"
                                    type="button">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </div>
                `;

                // Criar elemento jQuery e adicionar event listener
                const cardElement = $(cardHtml);
                cardElement.find('.app-card-delete-btn').on('click', function() {
                    exibirModalConfirmacaoExclusao(this);
                });

                container.append(cardElement);
            });
        },
        error: function(error) {
            let container2 = $('.texto-aqui');
            container2.html('<p class="text-danger text-center">Erro ao carregar contas de aplicativo.</p>');
            console.log(error);
        }
    });
}


// ----------------------
// MODAL DE CRIAÇÃO DE APP
// ----------------------

function exibirModalCriarApp() {
    // Garante reset e limpeza dos campos/formulário antes de abrir
    const form = document.getElementById('create-app-info-form');
    form.reset();
    form.classList.remove('was-validated'); // Remove estilo de validação anterior

    // Limpa mensagens de erro se houver
    const erroDiv = document.getElementById('erro-criar-app');
    if (erroDiv) erroDiv.textContent = '';

    // Preenche campo oculto com o id do cliente
    const clienteId = document.getElementById('info-cliente-id').textContent;
    document.getElementById('app-info-cliente-id').value = clienteId;

    // Fecha o modal de informações antes de abrir o de criação
    $('#info-cliente-modal').modal('hide');
    $('#create-app-info-modal').modal('show');
    document.getElementById('app-nome').dispatchEvent(new Event('change'));
}

$(function () {
    // Lógica para exibir/esconder campos do formulário conforme o app selecionado
    var appNomeSelect = document.getElementById('app-nome');
    if (appNomeSelect) {
        appNomeSelect.addEventListener('change', function () {
            var selectedOption = this.options[this.selectedIndex];
            var selectedValue = selectedOption.value;
            var deviceHasMac = selectedOption.dataset.deviceHasMac === 'true';
            var appName = selectedOption.textContent.trim().toLowerCase();

            var divDeviceId = document.getElementById('div-device-id');
            var divDeviceKey = document.getElementById('div-device-key');
            var divAppEmail = document.getElementById('div-app-email');
            var avisoSemConta = document.getElementById('app-sem-conta');
            var btnSalvar = document.getElementById('btn-salvar-app');

            var deviceId = document.getElementById('device-id');
            var deviceKey = document.getElementById('device-key');
            var email = document.getElementById('app-email');

            // Resetar visibilidade e requisitos
            if (divDeviceId) divDeviceId.style.display = 'none';
            if (divDeviceKey) divDeviceKey.style.display = 'none';
            if (divAppEmail) divAppEmail.style.display = 'none';
            if (avisoSemConta) avisoSemConta.style.display = 'none';
            if (btnSalvar) btnSalvar.disabled = false;

            if (deviceId) deviceId.removeAttribute('required');
            if (deviceKey) deviceKey.removeAttribute('required');
            if (email) email.removeAttribute('required');

            // Só processa se um app foi realmente selecionado
            if (selectedValue) {
                if (deviceHasMac) {
                    if (appName === 'clouddy') {
                        if (divDeviceKey) divDeviceKey.style.display = 'block';
                        if (divAppEmail) divAppEmail.style.display = 'block';
                        if (deviceKey) deviceKey.setAttribute('required', 'required');
                        if (email) email.setAttribute('required', 'required');
                    } else {
                        if (divDeviceId) divDeviceId.style.display = 'block';
                        if (divDeviceKey) divDeviceKey.style.display = 'block';
                        if (deviceId) deviceId.setAttribute('required', 'required');
                    }
                } else {
                    // App sem conta - permitir cadastro mas avisar usuário
                    if (avisoSemConta) {
                        avisoSemConta.style.display = 'block';
                        avisoSemConta.textContent = 'De acordo com o cadastro desse aplicativo, ele não requer conta, então você pode cadastrá-lo sem informar as credenciais da Conta do App.';
                        avisoSemConta.className = 'text-info mt-2';
                    }
                    if (btnSalvar) btnSalvar.disabled = false;
                }
            }
        });
    }

    // Validação de tamanho mínimo dos campos
    var deviceIdInput = document.getElementById('device-id');
    if (deviceIdInput) {
        deviceIdInput.addEventListener('input', function () {
            this.setCustomValidity(this.value.length >= 6 ? '' : 'O mínimo esperado é de 6 caracteres.');
        });
    }

    var deviceKeyInput = document.getElementById('device-key');
    if (deviceKeyInput) {
        deviceKeyInput.addEventListener('input', function () {
            this.setCustomValidity(this.value.length >= 5 ? '' : 'O mínimo esperado é de 5 caracteres.');
        });
    }

    // Submissão AJAX do cadastro do app
    $('#create-app-info-form').off('submit').on('submit', function (event) {
        event.preventDefault();
        var form = this;
        if (!form.checkValidity()) {
            event.stopPropagation();
            form.classList.add('was-validated');
            return;
        }
        var url = form.action;
        var formData = new FormData(form);
        var clienteId = $('#app-info-cliente-id').val();

        fetch(url, {
            method: 'POST',
            body: formData,
            headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {}
        })
            .then(response => {
                // ⭐ FASE 1: Parse JSON para verificar avisos de limite
                var contentType = response.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    return response.json().then(data => {
                        return { status: response.status, ok: response.ok, data: data };
                    });
                } else {
                    return { status: response.status, ok: response.ok, data: null };
                }
            })
            .then(result => {
                if (result.status === 200 || result.ok) {
                    // ⭐ FASE 1: Verificar se há aviso de limite
                    if (result.data && result.data.warning) {
                        // Fechar modal de cadastro temporariamente
                        $('#create-app-info-modal').modal('hide');

                        // Exibir modal de aviso de limite
                        if (typeof exibirAvisoLimite === 'function') {
                            exibirAvisoLimite({
                                plano: result.data.dados_aviso.plano,
                                usado: result.data.dados_aviso.usado,
                                callback: function() {
                                    // Usuário clicou em "Prosseguir Mesmo Assim"
                                    // Adicionar flag force_create e reenviar
                                    formData.append('force_create', 'true');

                                    fetch(url, {
                                        method: 'POST',
                                        body: formData,
                                        headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {}
                                    })
                                    .then(resp => resp.json())
                                    .then(respData => {
                                        if (respData.success_message_cancel) {
                                            // Sucesso - recarregar contas
                                            carregarContasApps(clienteId);
                                            $('#info-cliente-modal').modal('show');

                                            // Opcional: exibir mensagem de sucesso
                                            if (typeof Swal !== 'undefined') {
                                                Swal.fire({
                                                    icon: 'success',
                                                    title: 'Sucesso!',
                                                    text: respData.success_message_cancel,
                                                    timer: 2000
                                                });
                                            }
                                        }
                                    })
                                    .catch(error => {
                                        console.error('Erro ao forçar criação:', error);
                                        $('#create-app-error-message').text("Erro ao cadastrar conta do app.");
                                    });
                                }
                            });
                        } else {
                            // Função de aviso não disponível, seguir fluxo normal
                            console.warn('[FASE 1] Função exibirAvisoLimite não encontrada. Prosseguindo sem aviso.');
                            $('#create-app-info-modal').modal('hide');
                            $('#create-app-info-modal').one('hidden.bs.modal', function () {
                                carregarContasApps(clienteId);
                                $('#info-cliente-modal').modal('show');
                            });
                        }
                    } else if (result.data && result.data.success_message_cancel) {
                        // Sucesso normal - sem aviso
                        $('#create-app-info-modal').modal('hide');
                        $('#create-app-info-modal').one('hidden.bs.modal', function () {
                            carregarContasApps(clienteId);
                            $('#info-cliente-modal').modal('show');
                        });
                    } else {
                        // Resposta 200 mas sem dados esperados
                        $('#create-app-info-modal').modal('hide');
                        $('#create-app-info-modal').one('hidden.bs.modal', function () {
                            carregarContasApps(clienteId);
                            $('#info-cliente-modal').modal('show');
                        });
                    }
                } else {
                    // Erro HTTP
                    var errorMsg = (result.data && result.data.error_message) ? result.data.error_message : 'Erro ao cadastrar conta do app. Status: ' + result.status;
                    $('#create-app-error-message').text(errorMsg);
                }
            })
            .catch(error => {
                $('#create-app-error-message').text("Erro ao cadastrar conta do app.");
                console.error(error);
            });
    });

    // Fecha o modal de criação e volta para info
    $('#create-app-info-modal').on('click', '.btn-close, .btn-secondary', function () {
        $('#create-app-info-modal').modal('hide');
        $('#info-cliente-modal').modal('show');
    });
});


// ----------------------
// MODAL DE CONFIRMAÇÃO DE EXCLUSÃO
// ----------------------

var abrirInfoClienteAposExcluir = false;
var ultimoAppIdExcluido = null;

$(function() {
    // Submissão AJAX para exclusão
    $('#confirm-delete-app-conta-form').off('submit').on('submit', function(event) {
        event.preventDefault();
        var app_id = $('#app-conta-id').val();
        $.ajax({
            url: '/deletar-app-conta/' + app_id + '/',
            method: 'DELETE',
            beforeSend: function(xhr) {
                if (csrfToken) {
                    xhr.setRequestHeader("X-CSRFToken", csrfToken);
                }
            },
            success: function(response) {
                abrirInfoClienteAposExcluir = true;
                ultimoAppIdExcluido = app_id;
                $('#confirm-delete-app-conta-modal').modal('hide');
            },
            error: function(response) {
                var mensagem_erro = (response.responseJSON && response.responseJSON.error_message) ? response.responseJSON.error_message : "Erro ao excluir.";
                $('#delete-app-error-message').text(mensagem_erro);
                $('#delete-app-error-message').show();
            }
        });
    });

    // Ao cancelar exclusão, volta para o modal de info
    $('#confirm-delete-app-conta-modal').on('click', '.btn-close, .btn-secondary', function() {
        abrirInfoClienteAposExcluir = false;
        $('#confirm-delete-app-conta-modal').modal('hide');
        $('#info-cliente-modal').modal('show');
    });

    // Após fechar o modal de confirmação, recarrega as contas e reabre o info se exclusão foi confirmada
    $('#confirm-delete-app-conta-modal').on('hidden.bs.modal', function () {
        if (abrirInfoClienteAposExcluir) {
            abrirInfoClienteAposExcluir = false;
            var clienteId = document.getElementById('info-cliente-id').textContent;
            carregarContasApps(clienteId); // Recria a lista de cards no frontend
            $('#info-cliente-modal').modal('show');
            ultimoAppIdExcluido = null;
        }
        // Limpa mensagens de erro ao fechar modal
        $('#mensagem-erro').text('');
    });
});

// Função para exibir o modal de confirmação de exclusão
function exibirModalConfirmacaoExclusao(botao) {
    var app_id = $(botao).data('app-id');
    $('#app-conta-id').val(app_id);
    $('#info-cliente-modal').modal('hide');
    $('#confirm-delete-app-conta-modal').modal('show');
}

// ----------------------
// COPIAR PARA CLIPBOARD
// ----------------------

/**
 * Copia texto para o clipboard com feedback visual
 * @param {HTMLElement} botao - Botão que foi clicado
 * @param {string} texto - Texto a ser copiado
 */
function copiarParaClipboard(botao, texto) {
    // Verifica se a API moderna do Clipboard está disponível
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(() => {
            mostrarFeedbackCopia(botao, true);
        }).catch(err => {
            console.error('Erro ao copiar:', err);
            // Tenta fallback se API moderna falhar
            tentarFallbackCopia(botao, texto);
        });
    } else {
        // Fallback para navegadores mais antigos
        tentarFallbackCopia(botao, texto);
    }
}

/**
 * Fallback para copiar usando método antigo (document.execCommand)
 * @param {HTMLElement} botao - Botão que foi clicado
 * @param {string} texto - Texto a ser copiado
 */
function tentarFallbackCopia(botao, texto) {
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);

    try {
        textarea.select();
        textarea.setSelectionRange(0, 99999); // Para mobile
        const sucesso = document.execCommand('copy');
        mostrarFeedbackCopia(botao, sucesso);
    } catch (err) {
        console.error('Erro ao copiar (fallback):', err);
        mostrarFeedbackCopia(botao, false);
    } finally {
        document.body.removeChild(textarea);
    }
}

/**
 * Mostra feedback visual no botão de copiar
 * @param {HTMLElement} botao - Botão que foi clicado
 * @param {boolean} sucesso - Se a cópia foi bem sucedida
 */
function mostrarFeedbackCopia(botao, sucesso) {
    const $botao = $(botao);
    const iconOriginal = $botao.html();

    if (sucesso) {
        // Feedback de sucesso
        $botao.addClass('copied');
        $botao.html('<i class="bi bi-check-circle-fill"></i>');

        // Mostrar toast de sucesso (se disponível)
        if (typeof window.ToastManager !== 'undefined') {
            ToastManager.success('Copiado para a área de transferência!', 'Sucesso');
        }

        // Voltar ao estado original após 2 segundos
        setTimeout(() => {
            $botao.removeClass('copied');
            $botao.html(iconOriginal);
        }, 2000);
    } else {
        // Feedback de erro
        if (typeof window.ToastManager !== 'undefined') {
            ToastManager.error('Erro ao copiar para a área de transferência', 'Erro');
        } else {
            console.error('Não foi possível copiar para a área de transferência');
        }
    }
}

// ----------------------
// EXPORTAÇÕES GLOBAIS
// ----------------------
// Exporta todas as funções para o escopo global para que possam ser chamadas via onclick no HTML
window.exibirModalDetalhes = exibirModalDetalhes;
window.exibirModalCriarApp = exibirModalCriarApp;
window.exibirModalConfirmacaoExclusao = exibirModalConfirmacaoExclusao;
window.carregarContasApps = carregarContasApps;
window.carregarQuantidadeMensalidadesPagas = carregarQuantidadeMensalidadesPagas;
window.carregarIndicacoes = carregarIndicacoes;
window.copiarParaClipboard = copiarParaClipboard;
