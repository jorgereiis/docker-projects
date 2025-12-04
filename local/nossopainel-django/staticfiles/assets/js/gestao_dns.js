/**
 * Gestão de Domínios DNS - Frontend Controller
 *
 * Gerencia todo o fluxo de automação de migração DNS:
 * 1. Seleção de aplicativo
 * 2. Verificação de conta reseller
 * 3. Login manual (se necessário)
 * 4. Configuração da migração
 * 5. Execução e monitoramento em tempo real
 *
 * @author Claude Code
 * @version 1.0.0
 */

// ==================== ESTADO GLOBAL ====================

const GestaoDNS = {
    aplicativoSelecionado: null,
    tarefaAtualId: null,
    pollingInterval: null,
    pollingIntervalMs: 3000, // 3 segundos
    loginEmAndamento: false, // Flag para prevenir interrupções durante login
    loginPollingInterval: null, // Intervalo de polling do login
    loginTentativas: 0, // Contador de tentativas de verificação
    loginMaxTentativas: 20, // Máximo de tentativas (60 segundos)
    filtroAtivo: 'all', // Filtro atual ativo (tabela de progresso em tempo real)
    filtroDispositivosDetalhes: 'all', // Filtro de detalhes históricos
    tarefaIdAtual: null, // ID da tarefa de detalhes sendo visualizada

    // Novas variáveis para seleção dinâmica de domínios
    dominiosCarregados: false, // Flag para evitar recarregar domínios
    dispositivoBuscado: null, // Dispositivo encontrado por MAC
    playlistSelecionada: null, // Playlist escolhida pelo usuário
    dominioOrigemAtual: null, // Domínio origem selecionado

    // Proteção contra requisições paralelas
    isLoadingDominios: false, // Flag para prevenir execução paralela de carregarDominios()
    dominiosAbortController: null, // Controller para cancelar requisições anteriores

    /**
     * Filtra a tabela de dispositivos por status
     * @param {string} status - 'all', 'sucesso', 'erro', 'pulado'
     */
    filtrarPorStatus(status) {
        // Atualiza filtro ativo
        this.filtroAtivo = status;

        // Remove classe active de todos os cards
        document.querySelectorAll('.card-filter-clickable').forEach(card => {
            card.classList.remove('card-filter-active');
        });

        // Adiciona classe active no card clicado
        const cardAtivo = document.querySelector(`.card-filter-clickable[data-filter="${status}"]`);
        if (cardAtivo) {
            cardAtivo.classList.add('card-filter-active');
        }

        // Filtra linhas da tabela
        const tbody = document.getElementById('devices-tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            if (status === 'all') {
                row.style.display = '';
            } else {
                // Pega o status da linha (busca no badge)
                const statusBadge = row.querySelector('.badge.status-badge');
                if (statusBadge) {
                    const rowStatus = statusBadge.textContent.toLowerCase().trim();
                    // Mapeia textos para valores de filtro
                    const statusMap = {
                        'sucesso': 'sucesso',
                        'erro': 'erro',
                        'pulado': 'pulado',
                        'pendente': 'pendente',
                        'processando': 'processando'
                    };

                    const normalizedStatus = Object.keys(statusMap).find(key =>
                        rowStatus.includes(key)
                    );

                    if (normalizedStatus === status) {
                        row.style.display = '';
                    } else {
                        row.style.display = 'none';
                    }
                } else {
                    row.style.display = 'none';
                }
            }
        });
    },

    /**
     * Filtra a tabela de dispositivos de detalhes por status (COM PAGINAÇÃO AJAX)
     * @param {string} status - 'all', 'sucesso', 'erro', 'pulado'
     */
    filtrarDispositivosDetalhes(status) {
        // Remove classe active de todos os cards
        document.querySelectorAll('.card-filter-clickable-detalhes').forEach(card => {
            card.classList.remove('card-filter-active');
        });

        // Adiciona classe active no card clicado
        const cardAtivo = document.querySelector(`.card-filter-clickable-detalhes[data-filter="${status}"]`);
        if (cardAtivo) {
            cardAtivo.classList.add('card-filter-active');
        }

        // Recarrega dispositivos com o novo filtro (página 1)
        this.carregarDispositivosPaginados(1, status);
    },

    /**
     * Carrega dispositivos via AJAX com paginação
     * @param {number} page - Número da página
     * @param {string} statusFilter - Filtro de status ('all', 'sucesso', 'erro', 'pulado')
     */
    carregarDispositivosPaginados(page = 1, statusFilter = null) {
        // Usa filtro armazenado se não foi passado explicitamente
        const filtro = statusFilter !== null ? statusFilter : this.filtroDispositivosDetalhes;

        // Atualiza filtro armazenado
        this.filtroDispositivosDetalhes = filtro;

        // Mostra loading na tabela
        const tbody = document.getElementById('dispositivos-detalhes-tbody');
        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Carregando...</span>
                    </div>
                    <p class="mt-2 text-muted">Carregando dispositivos...</p>
                </td>
            </tr>
        `;

        // Desabilita controles de paginação durante o carregamento
        document.querySelectorAll('.pagination .page-link').forEach(link => {
            link.style.pointerEvents = 'none';
            link.style.opacity = '0.6';
        });

        // Faz requisição AJAX
        const url = new URL('/api/gestao-dns/dispositivos-paginados/', window.location.origin);
        url.searchParams.append('tarefa_id', this.tarefaIdAtual);
        url.searchParams.append('page', page);
        url.searchParams.append('status_filter', filtro);

        fetch(url, {
            method: 'GET',
            headers: {
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Atualiza tabela
                this.renderizarTabelaDispositivos(data.dispositivos);

                // Atualiza controles de paginação
                this.renderizarPaginacao(data.pagination);
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-4 text-danger">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            ${data.error || 'Erro ao carregar dispositivos'}
                        </td>
                    </tr>
                `;
                showToast('error', data.error || 'Erro ao carregar dispositivos');
            }
        })
        .catch(error => {
            console.error('Erro ao carregar dispositivos:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4 text-danger">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Erro de conexão. Tente novamente.
                    </td>
                </tr>
            `;
            showToast('error', 'Erro de conexão ao carregar dispositivos');
        })
        .finally(() => {
            // Reabilita controles de paginação
            document.querySelectorAll('.pagination .page-link').forEach(link => {
                link.style.pointerEvents = '';
                link.style.opacity = '';
            });
        });
    },

    /**
     * Renderiza linhas da tabela de dispositivos
     * @param {Array} dispositivos - Lista de dispositivos
     */
    renderizarTabelaDispositivos(dispositivos) {
        const tbody = document.getElementById('dispositivos-detalhes-tbody');
        if (!tbody) return;

        if (dispositivos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4 text-muted">
                        <i class="bi bi-info-circle me-2"></i>
                        Nenhum dispositivo encontrado para este filtro.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';

        dispositivos.forEach(dispositivo => {
            const row = document.createElement('tr');

            // Determina badge de status
            let badgeClass = 'secondary';
            let badgeIcon = '';
            let badgeText = dispositivo.status;

            switch (dispositivo.status) {
                case 'sucesso':
                    badgeClass = 'success';
                    badgeIcon = '<i class="bi bi-check-circle-fill"></i>';
                    badgeText = 'sucesso';
                    break;
                case 'erro':
                    badgeClass = 'danger';
                    badgeIcon = '<i class="bi bi-x-circle-fill"></i>';
                    badgeText = 'erro';
                    break;
                case 'pulado':
                    badgeClass = 'warning text-dark';
                    badgeIcon = '<i class="bi bi-skip-forward-fill"></i>';
                    badgeText = 'pulado';
                    break;
                case 'processando':
                    badgeClass = 'info';
                    badgeIcon = '<i class="bi bi-arrow-repeat"></i>';
                    badgeText = 'processando';
                    break;
            }

            row.innerHTML = `
                <td class="text-center"><code>${dispositivo.device_id}</code></td>
                <td class="text-center">${dispositivo.nome_dispositivo}</td>
                <td class="text-center">
                    <span class="badge bg-${badgeClass}">
                        ${badgeIcon} ${badgeText}
                    </span>
                </td>
                <td class="text-center"><small class="text-muted">${dispositivo.dns_encontrado}</small></td>
                <td class="text-center"><small class="text-success">${dispositivo.dns_atualizado}</small></td>
                <td class="text-center">
                    ${dispositivo.mensagem_erro ?
                        `<small class="text-danger">${dispositivo.mensagem_erro}</small>` :
                        '<small class="text-muted">-</small>'}
                </td>
            `;

            tbody.appendChild(row);
        });
    },

    /**
     * Renderiza controles de paginação
     * @param {Object} pagination - Dados de paginação
     */
    renderizarPaginacao(pagination) {
        const paginationContainer = document.querySelector('#dispositivos-detalhes-paginacao');
        if (!paginationContainer) return;

        if (pagination.total_pages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        let html = '<ul class="pagination justify-content-center">';

        // Botão "Anterior"
        if (pagination.has_previous) {
            html += `
                <li class="page-item">
                    <a class="page-link" href="#" data-page="${pagination.previous_page}" aria-label="Anterior">
                        <span aria-hidden="true">&laquo;</span>
                    </a>
                </li>
            `;
        } else {
            html += `
                <li class="page-item disabled">
                    <span class="page-link">&laquo;</span>
                </li>
            `;
        }

        // Números de página (mostra apenas páginas próximas)
        const currentPage = pagination.current_page;
        const totalPages = pagination.total_pages;

        for (let i = 1; i <= totalPages; i++) {
            // Mostra apenas páginas próximas (+/- 2 da atual)
            if (i === currentPage) {
                html += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
            } else if (i >= currentPage - 2 && i <= currentPage + 2) {
                html += `
                    <li class="page-item">
                        <a class="page-link" href="#" data-page="${i}">${i}</a>
                    </li>
                `;
            }
        }

        // Botão "Próximo"
        if (pagination.has_next) {
            html += `
                <li class="page-item">
                    <a class="page-link" href="#" data-page="${pagination.next_page}" aria-label="Próximo">
                        <span aria-hidden="true">&raquo;</span>
                    </a>
                </li>
            `;
        } else {
            html += `
                <li class="page-item disabled">
                    <span class="page-link">&raquo;</span>
                </li>
            `;
        }

        html += '</ul>';
        paginationContainer.innerHTML = html;

        // Adiciona event listeners aos links de paginação
        paginationContainer.querySelectorAll('a.page-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = parseInt(e.currentTarget.getAttribute('data-page'));
                GestaoDNS.carregarDispositivosPaginados(page);

                // Scroll suave até a tabela
                document.getElementById('dispositivos-detalhes-tbody')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            });
        });
    }
};

// ==================== CSRF TOKEN ====================

function getCsrfToken() {
    return document.querySelector('[name=csrfmiddlewaretoken]').value;
}

// ==================== CACHE DE DOMÍNIOS ====================

/**
 * Gerencia cache de domínios em sessionStorage
 *
 * Recursos:
 * - Armazenamento por aplicativo
 * - Expiração de 6 horas
 * - Invalidação manual
 * - Limpeza automática de cache expirado
 */
const DominiosCache = {
    CACHE_KEY: 'gestao_dns_cache',
    TTL_HOURS: 6,  // 6 horas
    CACHE_VERSION: '2.0',  // v2.0: armazena devices completos ao invés de apenas domínios

    /**
     * Retorna estrutura vazia do cache
     */
    _getEmptyCache() {
        return {
            cache_version: this.CACHE_VERSION,
            caches: {}
        };
    },

    /**
     * Carrega cache completo do sessionStorage
     */
    _loadCache() {
        try {
            const data = sessionStorage.getItem(this.CACHE_KEY);
            if (!data) return this._getEmptyCache();

            const parsed = JSON.parse(data);

            // Validar versão do cache
            if (parsed.cache_version !== this.CACHE_VERSION) {
                console.log('[Cache] Versão desatualizada, limpando cache');
                return this._getEmptyCache();
            }

            return parsed;
        } catch (error) {
            console.error('[Cache] Erro ao carregar cache:', error);
            return this._getEmptyCache();
        }
    },

    /**
     * Salva cache completo no sessionStorage
     */
    _saveCache(cacheData) {
        try {
            sessionStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
        } catch (error) {
            console.error('[Cache] Erro ao salvar cache:', error);
            // Quota exceeded - limpar cache antigo
            this.clear();
        }
    },

    /**
     * Verifica se cache do aplicativo está válido
     */
    isValid(aplicativoId) {
        const cache = this._loadCache();
        const key = `app_${aplicativoId}`;
        const entry = cache.caches[key];

        if (!entry) return false;

        const now = new Date();
        const expiresAt = new Date(entry.expires_at);

        return now < expiresAt;
    },

    /**
     * Extrai lista de domínios únicos a partir dos devices
     * @param {Array} devices - Array de dispositivos com playlists
     * @returns {Array} Array de {dominio, count}
     */
    _extractDominiosFromDevices(devices) {
        const dominiosMap = new Map();

        devices.forEach(device => {
            if (!device.playlists) return;

            device.playlists.forEach(playlist => {
                const dominio = playlist.dominio;
                if (dominio) {
                    if (dominiosMap.has(dominio)) {
                        dominiosMap.set(dominio, dominiosMap.get(dominio) + 1);
                    } else {
                        dominiosMap.set(dominio, 1);
                    }
                }
            });
        });

        // Converter Map para Array
        return Array.from(dominiosMap.entries())
            .map(([dominio, count]) => ({ dominio, count }))
            .sort((a, b) => b.count - a.count); // Ordenar por count decrescente
    },

    /**
     * Extrai apenas o hostname de uma URL completa
     * Ex: "http://domain1.com:8080" → "domain1.com"
     */
    _extrairDominioDeUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            // Se não for URL válida, retornar o valor original
            return url;
        }
    },

    /**
     * Retorna dados do cache (se válido)
     */
    get(aplicativoId) {
        if (!this.isValid(aplicativoId)) {
            console.log(`[Cache] Cache inválido ou expirado para app ${aplicativoId}`);
            return null;
        }

        const cache = this._loadCache();
        const key = `app_${aplicativoId}`;
        const entry = cache.caches[key];

        console.log(`[Cache] ✓ Cache HIT para app ${aplicativoId} (${entry.total_dominios} domínios, ${entry.total_dispositivos} dispositivos)`);

        // Calcular idade do cache
        const now = new Date();
        const cachedAt = new Date(entry.cached_at);
        const ageMinutes = Math.floor((now - cachedAt) / 60000);
        console.log(`[Cache] Idade do cache: ${ageMinutes} minutos`);

        return {
            devices: entry.devices || [],  // v2.0: retorna devices completos
            dominios: entry.dominios,
            cached_at: entry.cached_at,
            expires_at: entry.expires_at,
            age_minutes: ageMinutes
        };
    },

    /**
     * Armazena devices completos no cache (v2.0)
     * @param {Number} aplicativoId - ID do aplicativo
     * @param {String} aplicativoNome - Nome do aplicativo
     * @param {Array} devices - Array de dispositivos com playlists
     * @param {Array} dominios - (Opcional) Lista de domínios já extraída. Se null, será calculada automaticamente
     */
    set(aplicativoId, aplicativoNome, devices, dominios = null) {
        const cache = this._loadCache();
        const key = `app_${aplicativoId}`;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + (this.TTL_HOURS * 60 * 60 * 1000));

        // Se dominios não foi fornecido, extrair dos devices
        if (!dominios) {
            dominios = this._extractDominiosFromDevices(devices);
        }

        cache.caches[key] = {
            aplicativo_id: aplicativoId,
            aplicativo_nome: aplicativoNome,
            devices: devices,  // v2.0: armazena devices completos
            dominios: dominios,  // mantém para compatibilidade e acesso rápido
            total_dominios: dominios.length,
            total_dispositivos: devices.length,
            cached_at: now.toISOString(),
            expires_at: expiresAt.toISOString()
        };

        this._saveCache(cache);
        console.log(`[Cache] ✓ Cache v2.0 salvo para app ${aplicativoId}: ${devices.length} dispositivos, ${dominios.length} domínios únicos (expira em ${this.TTL_HOURS}h)`);
    },

    /**
     * Invalida cache de um aplicativo específico
     */
    invalidate(aplicativoId) {
        const cache = this._loadCache();
        const key = `app_${aplicativoId}`;

        if (cache.caches[key]) {
            delete cache.caches[key];
            this._saveCache(cache);
            console.log(`[Cache] Cache invalidado para app ${aplicativoId}`);
            return true;
        }

        return false;
    },

    /**
     * Limpa todo o cache
     */
    clear() {
        sessionStorage.removeItem(this.CACHE_KEY);
        console.log('[Cache] Cache completo limpo');
    },

    /**
     * Remove entradas expiradas (garbage collection)
     */
    cleanup() {
        const cache = this._loadCache();
        const now = new Date();
        let removed = 0;

        Object.keys(cache.caches).forEach(key => {
            const entry = cache.caches[key];
            const expiresAt = new Date(entry.expires_at);

            if (now >= expiresAt) {
                delete cache.caches[key];
                removed++;
            }
        });

        if (removed > 0) {
            this._saveCache(cache);
            console.log(`[Cache] Cleanup: ${removed} cache(s) expirado(s) removido(s)`);
        }

        return removed;
    },

    /**
     * Retorna estatísticas do cache
     */
    getStats() {
        const cache = this._loadCache();
        const now = new Date();
        const stats = {
            total_caches: 0,
            valid_caches: 0,
            expired_caches: 0,
            total_dominios: 0,
            apps: []
        };

        Object.values(cache.caches).forEach(entry => {
            stats.total_caches++;

            const expiresAt = new Date(entry.expires_at);
            const isValid = now < expiresAt;

            if (isValid) {
                stats.valid_caches++;
                stats.total_dominios += entry.total_dominios;
            } else {
                stats.expired_caches++;
            }

            stats.apps.push({
                id: entry.aplicativo_id,
                nome: entry.aplicativo_nome,
                dominios: entry.total_dominios,
                dispositivos: entry.total_dispositivos,
                cached_at: entry.cached_at,
                expires_at: entry.expires_at,
                is_valid: isValid
            });
        });

        return stats;
    }
};

// ==================== HELPERS ====================

function showStep(stepId) {
    // Esconde todos os steps
    document.querySelectorAll('[id^="step-"]').forEach(step => {
        step.classList.add('hidden');
    });

    // Mostra o step solicitado
    const step = document.getElementById(stepId);
    if (step) {
        step.classList.remove('hidden');
    }
}

function formatDate(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('pt-BR');
}

// ==================== ETAPA 1: SELEÇÃO DE APLICATIVO ====================

function initAppSelection() {
    const appCards = document.querySelectorAll('.app-card');

    appCards.forEach(card => {
        card.addEventListener('click', function() {
            const appId = this.dataset.appId;
            const appName = this.dataset.appName;
            const temAutomacao = this.dataset.temAutomacao === 'true';

            // Bloqueia clique se não tem automação
            if (!temAutomacao) {
                showToast('warning', `Automação ainda não implementada para ${appName}`);
                return;
            }

            // Marca como selecionado
            appCards.forEach(c => c.classList.remove('selected'));
            this.classList.add('selected');

            GestaoDNS.aplicativoSelecionado = {
                id: appId,
                nome: appName
            };

            // Avança para verificação de conta
            verificarConta(appId);
        });
    });
}

// ==================== ETAPA 2: VERIFICAÇÃO DE CONTA ====================

function verificarConta(appId) {
    showStep('step-account-status');

    // Mostra loading
    document.getElementById('account-status-content').innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Verificando...</span>
            </div>
            <p class="mt-3 text-muted">Verificando status da conta...</p>
        </div>
    `;

    // Faz requisição para verificar conta
    fetch('/api/gestao-dns/verificar-conta/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': getCsrfToken()
        },
        body: `aplicativo_id=${appId}`
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'nao_implementado') {
            // Aplicativo sem automação
            document.getElementById('account-status-content').innerHTML = `
                <div class="alert alert-warning">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    ${data.mensagem}
                </div>
            `;
        } else if (data.status === 'sem_conta') {
            // Precisa fazer login
            document.getElementById('account-status-content').innerHTML = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle-fill me-2"></i>
                    ${data.mensagem}
                </div>
                <button class="btn btn-primary btn-lg w-100" onclick="mostrarFormularioLogin()">
                    <i class="bi bi-box-arrow-in-right me-2"></i>Fazer Login Manual
                </button>
            `;
        } else if (data.status === 'sessao_expirada') {
            // Sessão expirou
            document.getElementById('account-status-content').innerHTML = `
                <div class="alert alert-warning">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    <strong>Sessão Expirada</strong><br>
                    Último acesso: ${formatDate(data.ultimo_login)}
                </div>
                <button class="btn btn-warning btn-lg w-100" onclick="mostrarFormularioLogin()">
                    <i class="bi bi-arrow-repeat me-2"></i>Renovar Login
                </button>
            `;
        } else if (data.status === 'ok') {
            // Conta válida! Vai direto para configuração
            document.getElementById('account-status-content').innerHTML = `
                <div class="alert alert-success">
                    <i class="bi bi-check-circle-fill me-2"></i>
                    <strong>Conta Autenticada</strong><br>
                    Email: ${data.email}<br>
                    Último acesso: ${formatDate(data.ultimo_login)}
                </div>
            `;

            // Aguarda 1 segundo e avança
            setTimeout(() => {
                mostrarConfiguracaoMigracao();
            }, 1000);
        }
    })
    .catch(error => {
        console.error('Erro ao verificar conta:', error);
        showToast('error', 'Erro ao verificar conta. Tente novamente.');
    });
}

// ==================== ETAPA 3: LOGIN MANUAL ====================

function mostrarFormularioLogin() {
    showStep('step-login-manual');

    // Preenche aplicativo_id
    document.getElementById('login-aplicativo-id').value = GestaoDNS.aplicativoSelecionado.id;
}

/**
 * Atualiza interface visual das etapas de login baseado no progresso
 * @param {string} progresso - Etapa atual do login
 */
function atualizarEtapasVisuais(progresso) {
    console.log(`[Etapas Visuais] Atualizando para progresso: ${progresso}`);

    // Mapeamento de progresso para ações visuais
    switch(progresso) {
        case 'conectando':
            // Etapa 1: mostra spinner
            mostrarSpinner(1);
            break;

        case 'pagina_carregada':
            // Etapa 1: completa (check)
            marcarEtapaConcluida(1);
            // Etapa 2: inicia spinner
            mostrarSpinner(2);
            break;

        case 'resolvendo_captcha':
            // Etapa 1: completa
            marcarEtapaConcluida(1);
            // Etapa 2: mostra spinner
            mostrarSpinner(2);
            break;

        case 'captcha_resolvido':
            // Etapa 1 e 2: completas
            marcarEtapaConcluida(1);
            marcarEtapaConcluida(2);
            // Etapa 3: inicia spinner
            mostrarSpinner(3);
            break;

        case 'validando':
            // Etapa 1 e 2: completas
            marcarEtapaConcluida(1);
            marcarEtapaConcluida(2);
            // Etapa 3: mostra spinner
            mostrarSpinner(3);
            break;

        case 'concluido':
            // Todas as etapas completas
            marcarEtapaConcluida(1);
            marcarEtapaConcluida(2);
            marcarEtapaConcluida(3);
            break;

        case 'erro':
            // Marca etapa atual como erro (opcional)
            console.error('[Etapas Visuais] Erro no processo de login');
            break;

        default:
            console.log(`[Etapas Visuais] Progresso desconhecido: ${progresso}`);
    }
}

/**
 * Mostra spinner para uma etapa específica
 * @param {number} etapaNum - Número da etapa (1, 2 ou 3)
 */
function mostrarSpinner(etapaNum) {
    const spinner = document.getElementById(`etapa-${etapaNum}-spinner`);
    const check = document.getElementById(`etapa-${etapaNum}-check`);

    if (spinner && check) {
        spinner.classList.remove('d-none');
        check.classList.add('d-none');
    }
}

/**
 * Marca etapa como concluída (troca spinner por check)
 * @param {number} etapaNum - Número da etapa (1, 2 ou 3)
 */
function marcarEtapaConcluida(etapaNum) {
    const spinner = document.getElementById(`etapa-${etapaNum}-spinner`);
    const check = document.getElementById(`etapa-${etapaNum}-check`);

    if (spinner && check) {
        spinner.classList.add('d-none');
        check.classList.remove('d-none');
        console.log(`[Etapas Visuais] ✓ Etapa ${etapaNum} concluída`);
    }
}

/**
 * Verifica status do login em andamento (polling silencioso sem mudar telas)
 * Chama a API de verificação de conta mas não altera a UI, apenas atualiza mensagens de progresso
 */
function verificarLoginEmAndamento() {
    if (!GestaoDNS.loginEmAndamento || !GestaoDNS.aplicativoSelecionado) {
        console.log('[Login Polling] Polling cancelado - loginEmAndamento=false ou app não selecionado');
        return;
    }

    // Incrementa contador de tentativas
    GestaoDNS.loginTentativas++;

    console.log(`[Login Polling] Tentativa ${GestaoDNS.loginTentativas}/${GestaoDNS.loginMaxTentativas} - Verificando status...`);

    // Verifica se atingiu o timeout máximo
    if (GestaoDNS.loginTentativas > GestaoDNS.loginMaxTentativas) {
        console.warn('[Login Polling] Timeout atingido - Parando polling');

        // Para o polling
        if (GestaoDNS.loginPollingInterval) {
            clearInterval(GestaoDNS.loginPollingInterval);
            GestaoDNS.loginPollingInterval = null;
        }

        // Mostra mensagem de timeout com opção de continuar aguardando
        mostrarMensagemLoginProgresso('warning',
            '<i class="bi bi-clock-history fs-1 text-warning mb-3"></i>' +
            '<h5 class="text-warning">O login está demorando mais que o esperado</h5>' +
            '<p class="text-muted">O processo de autenticação pode levar até 2 minutos em alguns casos.</p>' +
            '<p class="text-muted small">Tentativas realizadas: ' + GestaoDNS.loginTentativas + '</p>' +
            '<div class="d-grid gap-2 mt-3">' +
                '<button class="btn btn-primary" onclick="continuarAguardandoLogin()">Continuar Aguardando</button>' +
                '<button class="btn btn-outline-secondary" onclick="location.reload()">Recarregar Página</button>' +
            '</div>'
        );

        return;
    }

    // Atualiza feedback visual de progresso
    atualizarProgressoLogin(GestaoDNS.loginTentativas, GestaoDNS.loginMaxTentativas);

    fetch(`/api/gestao-dns/verificar-conta/?aplicativo_id=${GestaoDNS.aplicativoSelecionado.id}`, {
        method: 'GET',
        headers: {
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        console.log('[Login Polling] Resposta da API:', data);

        // Atualizar etapas visuais baseado no progresso reportado pelo backend
        if (data.login_progresso) {
            console.log('[Login Polling] Progresso do backend:', data.login_progresso);
            atualizarEtapasVisuais(data.login_progresso);
        }

        if (data.status === 'ok') {
            // Login completado com sucesso!
            console.log('[Login Polling] ✅ Login concluído com sucesso!');
            console.log('[Login Polling] Sessão válida:', data.sessao_valida);
            console.log('[Login Polling] Email:', data.email);
            console.log('[Login Polling] Último login:', data.ultimo_login);

            // Garantir que todas as etapas aparecem como concluídas
            atualizarEtapasVisuais('concluido');

            GestaoDNS.loginEmAndamento = false;

            // Para o polling
            if (GestaoDNS.loginPollingInterval) {
                clearInterval(GestaoDNS.loginPollingInterval);
                GestaoDNS.loginPollingInterval = null;
            }

            // Aguardar 2 segundos antes de mostrar mensagem final (para ver todas as etapas completas)
            setTimeout(() => {
                // Atualiza mensagem de sucesso
                mostrarMensagemLoginProgresso('success',
                    '<i class="bi bi-check-circle-fill fs-1 text-success mb-3"></i>' +
                    '<h5 class="text-success">Login realizado com sucesso!</h5>' +
                    '<p class="text-muted">Sessão autenticada. Redirecionando...</p>' +
                    '<p class="text-muted small">Total de tentativas: ' + GestaoDNS.loginTentativas + '</p>'
                );

                // Aguarda mais 2 segundos e redireciona para configuração de migração
                setTimeout(() => {
                    console.log('[Login Polling] Redirecionando para configuração de migração...');
                    mostrarConfiguracaoMigracao();
                }, 2000);
            }, 2000);

        } else if (data.status === 'sessao_expirada' || data.status === 'sem_conta') {
            // Login ainda em andamento, continua aguardando...
            console.log('[Login Polling] ⏳ Status:', data.status, '- Aguardando conclusão do login...');
            console.log('[Login Polling] Mensagem:', data.mensagem);
            // Continua polling (não faz nada)

        } else if (data.error) {
            // Erro durante o login
            console.error('[Login Polling] ❌ Erro retornado pela API:', data.error);

            GestaoDNS.loginEmAndamento = false;

            // Para o polling
            if (GestaoDNS.loginPollingInterval) {
                clearInterval(GestaoDNS.loginPollingInterval);
                GestaoDNS.loginPollingInterval = null;
            }

            // Mostra erro e permite tentar novamente
            mostrarMensagemLoginProgresso('error',
                '<i class="bi bi-x-circle-fill fs-1 text-danger mb-3"></i>' +
                '<h5 class="text-danger">Erro no login automático</h5>' +
                '<p class="text-muted">' + (data.error || 'Erro desconhecido') + '</p>' +
                '<p class="text-muted small">Tentativas realizadas: ' + GestaoDNS.loginTentativas + '</p>' +
                '<button class="btn btn-primary mt-3" onclick="location.reload()">Tentar Novamente</button>'
            );
        } else {
            // Status desconhecido
            console.warn('[Login Polling] ⚠️ Status desconhecido:', data.status);
        }
    })
    .catch(error => {
        console.error('[Login Polling] ❌ Erro de rede ao verificar status:', error);
        // Não para o polling em caso de erro de rede, continua tentando
        console.log('[Login Polling] Continuando polling apesar do erro de rede...');
    });
}

/**
 * Atualiza indicador visual de progresso do login
 */
function atualizarProgressoLogin(tentativa, maxTentativas) {
    const progresso = Math.min((tentativa / maxTentativas) * 100, 100);
    const tempoDecorrido = tentativa * 3; // segundos

    // Atualiza a área de progresso se existir
    const progressoElement = document.getElementById('login-progresso-info');
    if (progressoElement) {
        progressoElement.innerHTML = `
            <small class="text-muted">
                <i class="bi bi-hourglass-split me-1"></i>
                Verificação ${tentativa}/${maxTentativas} (${tempoDecorrido}s decorridos)
            </small>
            <div class="progress mt-2" style="height: 4px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated"
                     role="progressbar"
                     style="width: ${progresso}%"
                     aria-valuenow="${progresso}"
                     aria-valuemin="0"
                     aria-valuemax="100">
                </div>
            </div>
        `;
    }
}

/**
 * Continua aguardando o login após timeout
 */
function continuarAguardandoLogin() {
    console.log('[Login Polling] Usuário optou por continuar aguardando');

    // Reseta contador e adiciona mais 20 tentativas
    GestaoDNS.loginTentativas = 0;
    GestaoDNS.loginMaxTentativas += 20;

    // Reinicia polling
    if (GestaoDNS.loginPollingInterval) {
        clearInterval(GestaoDNS.loginPollingInterval);
    }

    GestaoDNS.loginPollingInterval = setInterval(() => {
        verificarLoginEmAndamento();
    }, 3000);

    // Mostra mensagem de continuação
    mostrarMensagemLoginProgresso('progress',
        '<div class="mb-4">' +
            '<div class="spinner-border text-primary mb-3" style="width: 4rem; height: 4rem;" role="status">' +
                '<span class="visually-hidden">Processando...</span>' +
            '</div>' +
        '</div>' +
        '<h5 class="mb-3">Continuando verificação...</h5>' +
        '<p class="text-muted">Aguardando conclusão do processo de autenticação.</p>' +
        '<div id="login-progresso-info" class="mt-3"></div>'
    );

    // Verifica imediatamente
    verificarLoginEmAndamento();
}

/**
 * Mostra mensagem de progresso na área de login (sem mudar de tela)
 */
function mostrarMensagemLoginProgresso(tipo, conteudoHtml) {
    const loginArea = document.getElementById('login-form-area');
    if (!loginArea) return;

    const corFundo = tipo === 'success' ? 'bg-success-subtle' :
                     tipo === 'error' ? 'bg-danger-subtle' : 'bg-primary-subtle';

    loginArea.innerHTML = `
        <div class="card ${corFundo} border-0">
            <div class="card-body text-center py-5">
                ${conteudoHtml}
            </div>
        </div>
    `;
}

function initLoginForm() {
    const form = document.getElementById('form-login-manual');

    form.addEventListener('submit', function(e) {
        e.preventDefault();

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;

        // Desabilita botão
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Iniciando automação...';

        // Envia requisição
        const formData = new FormData(form);

        fetch('/api/gestao-dns/login-manual/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCsrfToken()
            },
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'login_iniciado') {
                console.log('[Login Form] ✅ Automação iniciada - Configurando polling...');

                // Marca que login está em andamento e reseta contador
                GestaoDNS.loginEmAndamento = true;
                GestaoDNS.loginTentativas = 0;
                GestaoDNS.loginMaxTentativas = 20; // Reset para valor padrão

                // Substitui formulário por interface de progresso
                mostrarMensagemLoginProgresso('progress',
                    '<div class="mb-4">' +
                        '<div class="spinner-border text-primary mb-3" style="width: 4rem; height: 4rem;" role="status">' +
                            '<span class="visually-hidden">Processando...</span>' +
                        '</div>' +
                    '</div>' +
                    '<h5 class="mb-3">Autenticação em andamento</h5>' +
                    '<div class="text-start bg-white rounded p-3 mb-3" style="max-width: 400px; margin: 0 auto;">' +
                        // Etapa 1: Conectando
                        '<div class="d-flex align-items-center mb-2" id="etapa-1">' +
                            '<div class="spinner-border spinner-border-sm text-primary me-2" id="etapa-1-spinner"></div>' +
                            '<i class="bi bi-check-circle-fill text-success me-2 d-none" style="font-size: 1.2rem;" id="etapa-1-check"></i>' +
                            '<span class="text-muted">Conectando ao painel reseller...</span>' +
                        '</div>' +
                        // Etapa 2: reCAPTCHA
                        '<div class="d-flex align-items-center mb-2" id="etapa-2">' +
                            '<div class="spinner-border spinner-border-sm text-primary me-2 d-none" id="etapa-2-spinner"></div>' +
                            '<i class="bi bi-check-circle-fill text-success me-2 d-none" style="font-size: 1.2rem;" id="etapa-2-check"></i>' +
                            '<span class="text-muted">Resolvendo reCAPTCHA automaticamente...</span>' +
                        '</div>' +
                        // Etapa 3: Validando
                        '<div class="d-flex align-items-center" id="etapa-3">' +
                            '<div class="spinner-border spinner-border-sm text-primary me-2 d-none" id="etapa-3-spinner"></div>' +
                            '<i class="bi bi-check-circle-fill text-success me-2 d-none" style="font-size: 1.2rem;" id="etapa-3-check"></i>' +
                            '<span class="text-muted">Validando credenciais...</span>' +
                        '</div>' +
                    '</div>' +
                    '<div id="login-progresso-info" class="mt-3"></div>' +
                    '<p class="text-muted small mt-3"><i class="bi bi-info-circle me-1"></i>Este processo pode levar até 60 segundos. Por favor, aguarde...</p>'
                );

                showToast('success', 'Automação iniciada! Aguarde o processamento...');

                console.log('[Login Form] Iniciando polling com intervalo de 3 segundos');

                // Inicia polling silencioso para verificar conclusão (a cada 3 segundos)
                GestaoDNS.loginPollingInterval = setInterval(() => {
                    verificarLoginEmAndamento();
                }, 3000);

                // Primeira verificação após 1 segundo (mais rápida para logins instantâneos)
                setTimeout(() => {
                    console.log('[Login Form] Executando primeira verificação...');
                    verificarLoginEmAndamento();
                }, 1000);

            } else {
                showToast('error', data.error || 'Erro ao iniciar login');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        })
        .catch(error => {
            console.error('Erro ao iniciar login:', error);
            showToast('error', 'Erro ao iniciar login. Tente novamente.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        });
    });
}

// ==================== ETAPA 4: CONFIGURAÇÃO DA MIGRAÇÃO ====================

function mostrarConfiguracaoMigracao() {
    showStep('step-migracao-config');

    // Preenche aplicativo_id
    document.getElementById('migracao-aplicativo-id').value = GestaoDNS.aplicativoSelecionado.id;
}

/**
 * Popula o select de domínios com os dados
 */
function popularSelectDominios(dominios, fromCache = false, ageMinutes = null) {
    const select = document.getElementById('dominio-origem-select');
    select.innerHTML = '<option value="">-- Selecione um domínio --</option>';

    dominios.forEach(item => {
        const option = document.createElement('option');
        option.value = item.dominio;

        let label = `${item.dominio} (${item.count} dispositivos)`;
        if (fromCache && ageMinutes !== null) {
            const ageText = ageMinutes < 60
                ? `${ageMinutes}min`
                : `${Math.floor(ageMinutes / 60)}h${ageMinutes % 60}min`;
            label += ` [cache: ${ageText}]`;
        }

        option.textContent = label;
        select.appendChild(option);
    });

    select.disabled = false;
}

/**
 * Mostra loading indicator
 */
function mostrarLoadingDominios() {
    const loadingDiv = document.getElementById('loading-dominios');
    const sectionOrigemDiv = document.getElementById('section-dominio-origem');
    const sectionDestinoDiv = document.getElementById('section-dominio-destino');
    const sectionSubmitDiv = document.getElementById('section-submit');

    loadingDiv.classList.remove('hidden');
    sectionOrigemDiv.classList.add('hidden');
    sectionDestinoDiv.classList.add('hidden');
    sectionSubmitDiv.classList.add('hidden');

    const select = document.getElementById('dominio-origem-select');
    select.innerHTML = '<option value="">Carregando domínios...</option>';
    select.disabled = true;
}

/**
 * Mostra seções de migração após carregar domínios
 */
function mostrarSecoesMigracao() {
    const loadingDiv = document.getElementById('loading-dominios');
    const sectionOrigemDiv = document.getElementById('section-dominio-origem');
    const sectionDestinoDiv = document.getElementById('section-dominio-destino');
    const sectionSubmitDiv = document.getElementById('section-submit');

    loadingDiv.classList.add('hidden');
    sectionOrigemDiv.classList.remove('hidden');
    sectionDestinoDiv.classList.remove('hidden');
    sectionSubmitDiv.classList.remove('hidden');
}

/**
 * Trata erro ao carregar domínios
 */
function tratarErroDominios(errorMsg) {
    const select = document.getElementById('dominio-origem-select');
    select.innerHTML = '<option value="">Erro ao carregar domínios</option>';

    const loadingDiv = document.getElementById('loading-dominios');
    const sectionOrigemDiv = document.getElementById('section-dominio-origem');

    loadingDiv.classList.add('hidden');
    sectionOrigemDiv.classList.remove('hidden');

    showToast('error', errorMsg || 'Erro ao carregar domínios');
}

/**
 * Carrega lista de domínios únicos do reseller account
 * Chamado quando usuário seleciona "Todos os domínios"
 */
async function carregarDominios() {
    if (!GestaoDNS.aplicativoSelecionado) return;

    // ===== CAMADA 1: PREVENIR EXECUÇÃO PARALELA =====
    if (GestaoDNS.isLoadingDominios) {
        console.warn('[DNS] Já há um carregamento de domínios em andamento - operação ignorada');
        return;
    }

    // Marca que começou o carregamento
    GestaoDNS.isLoadingDominios = true;

    // ===== CAMADA 2: VERIFICAR CACHE =====
    const appId = GestaoDNS.aplicativoSelecionado.id;
    const cached = DominiosCache.get(appId);

    console.log('[Cache DEBUG] ==================== CARREGANDO DOMÍNIOS ====================');
    console.log('[Cache DEBUG] appId:', appId);
    console.log('[Cache DEBUG] Cache encontrado:', cached ? 'SIM' : 'NÃO');

    if (cached) {
        // Usar dados do cache
        console.log('[DNS] Usando domínios do cache');
        console.log('[Cache DEBUG] Domínios no cache:', cached.dominios);
        console.log('[Cache DEBUG] Lista de domínios:', cached.dominios.map(d => `${d.dominio} (${d.count})`));

        popularSelectDominios(cached.dominios, true, cached.age_minutes);
        mostrarSecoesMigracao();

        GestaoDNS.dominiosCarregados = true;
        GestaoDNS.isLoadingDominios = false;

        const ageText = cached.age_minutes < 60
            ? `${cached.age_minutes}min atrás`
            : `${Math.floor(cached.age_minutes / 60)}h${cached.age_minutes % 60}min atrás`;

        showToast('info', `${cached.dominios.length} domínios carregados do cache (${ageText})`);
        console.log('[Cache DEBUG] ==================== FIM CARREGAMENTO ====================');
        return;
    }

    // ===== CAMADA 3: CANCELAR REQUISIÇÃO ANTERIOR =====
    if (GestaoDNS.dominiosAbortController) {
        console.log('[DNS] Cancelando requisição anterior de domínios');
        GestaoDNS.dominiosAbortController.abort();
    }

    // Cria novo AbortController para esta requisição
    GestaoDNS.dominiosAbortController = new AbortController();

    // Mostrar loading indicator
    mostrarLoadingDominios();

    try {
        const response = await fetch(`/api/gestao-dns/listar-dominios/?aplicativo_id=${appId}`, {
            method: 'GET',
            headers: { 'X-CSRFToken': getCsrfToken() },
            signal: GestaoDNS.dominiosAbortController.signal // ⚠️ Permite cancelamento
        });

        const data = await response.json();

        if (data.success) {
            // ===== SALVAR NO CACHE v2.0 =====
            // Backend agora retorna {devices: [...], dominios: [...]}
            const devices = data.devices || [];
            const dominios = data.dominios || [];

            // Salvar devices completos no cache
            DominiosCache.set(appId, GestaoDNS.aplicativoSelecionado.nome, devices, dominios);

            popularSelectDominios(dominios, false);
            mostrarSecoesMigracao();

            GestaoDNS.dominiosCarregados = true;

            showToast('success', `${dominios.length} domínios encontrados em ${devices.length} dispositivos`);
        } else {
            tratarErroDominios(data.error);
        }
    } catch (error) {
        // Detecta se foi um cancelamento proposital (AbortError)
        if (error.name === 'AbortError') {
            console.log('[DNS] ✓ Requisição de domínios cancelada com sucesso');
            return; // Não mostra erro para o usuário (cancelamento é intencional)
        }

        console.error('Erro ao carregar domínios:', error);
        tratarErroDominios('Erro de conexão');
    } finally {
        // ===== SEMPRE RESETA FLAG =====
        GestaoDNS.isLoadingDominios = false;
    }
}

/**
 * Busca dispositivo por MAC e lista playlists
 * Chamado quando usuário digita MAC em "Dispositivo específico"
 */
async function buscarDispositivoPorMAC(mac) {
    if (!mac || mac.length < 17) return; // MAC incompleto

    const playlistsDiv = document.getElementById('div-playlists');
    const loadingDiv = document.getElementById('playlists-loading');
    const containerDiv = document.getElementById('playlists-container');

    // Mostrar loading
    playlistsDiv.classList.remove('hidden');
    loadingDiv.classList.remove('d-none');
    containerDiv.classList.add('d-none');
    containerDiv.innerHTML = '';

    try {
        const response = await fetch('/api/gestao-dns/buscar-dispositivo/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({
                aplicativo_id: GestaoDNS.aplicativoSelecionado.id,
                mac_address: mac
            })
        });

        const data = await response.json();

        if (data.success) {
            GestaoDNS.dispositivoBuscado = data.device;

            // Esconder loading
            loadingDiv.classList.add('d-none');

            if (data.playlists.length === 0) {
                containerDiv.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Nenhuma playlist encontrada para este dispositivo.
                    </div>
                `;
                containerDiv.classList.remove('d-none');
                return;
            }

            // Renderizar radio buttons para cada playlist
            data.playlists.forEach((playlist, index) => {
                const radioDiv = document.createElement('div');
                radioDiv.className = 'form-check mb-2 p-3 border rounded';
                if (playlist.is_selected) {
                    radioDiv.classList.add('bg-light');
                }

                radioDiv.innerHTML = `
                    <input class="form-check-input" type="radio"
                           name="playlist_origem"
                           id="playlist-${playlist.id}"
                           value="${playlist.id}"
                           data-dominio="${playlist.dominio}"
                           data-url="${playlist.url}"
                           ${playlist.is_selected ? 'checked' : ''} required>
                    <label class="form-check-label w-100" for="playlist-${playlist.id}">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <strong>${playlist.name}</strong>
                                ${playlist.is_selected ? '<span class="badge bg-success ms-2">Padrão</span>' : ''}
                                <br>
                                <small class="text-muted">Domínio: <code>${playlist.dominio}</code></small>
                            </div>
                        </div>
                    </label>
                `;

                containerDiv.appendChild(radioDiv);
            });

            // Adicionar event listeners aos radios
            containerDiv.querySelectorAll('input[name="playlist_origem"]').forEach(radio => {
                radio.addEventListener('change', function() {
                    GestaoDNS.playlistSelecionada = {
                        id: parseInt(this.value),
                        dominio: this.dataset.dominio,
                        url: this.dataset.url
                    };

                    // Atualizar campo read-only de domínio origem
                    const inputReadonly = document.getElementById('dominio-origem-input');
                    inputReadonly.value = this.dataset.dominio;
                    GestaoDNS.dominioOrigemAtual = this.dataset.dominio;

                    console.log('Playlist selecionada:', GestaoDNS.playlistSelecionada);
                });
            });

            // Selecionar automaticamente a playlist padrão se houver
            const defaultRadio = containerDiv.querySelector('input[type="radio"]:checked');
            if (defaultRadio) {
                defaultRadio.dispatchEvent(new Event('change'));
            }

            containerDiv.classList.remove('d-none');

            // Revelar seções de Domínio Destino e Submit após playlists carregadas
            document.getElementById('section-dominio-destino').classList.remove('hidden');
            document.getElementById('section-submit').classList.remove('hidden');

            showToast('success', `${data.playlists.length} playlist(s) encontrada(s)`);

        } else {
            loadingDiv.classList.add('d-none');
            containerDiv.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-x-circle me-2"></i>
                    ${data.error || 'Dispositivo não encontrado'}
                </div>
            `;
            containerDiv.classList.remove('d-none');
            showToast('error', data.error || 'Dispositivo não encontrado');
        }

    } catch (error) {
        console.error('Erro ao buscar dispositivo:', error);
        loadingDiv.classList.add('d-none');
        containerDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-x-circle me-2"></i>
                Erro de conexão ao buscar dispositivo
            </div>
        `;
        containerDiv.classList.remove('d-none');
        showToast('error', 'Erro ao buscar dispositivo');
    }
}

function initMigracaoForm() {
    const form = document.getElementById('form-migracao');
    const tipoTodos = document.getElementById('tipo-todos');
    const tipoEspecifico = document.getElementById('tipo-especifico');
    const divMacEspecifico = document.getElementById('div-mac-especifico');
    const divPlaylists = document.getElementById('div-playlists');
    const macInput = document.getElementById('mac-alvo');

    // Elementos de seções
    const loadingDominios = document.getElementById('loading-dominios');
    const sectionOrigemDiv = document.getElementById('section-dominio-origem');
    const sectionDestinoDiv = document.getElementById('section-dominio-destino');
    const sectionSubmitDiv = document.getElementById('section-submit');
    const dominioOrigemSelect = document.getElementById('dominio-origem-select');

    // ===== TOGGLE: Todos os domínios =====
    tipoTodos.addEventListener('change', function() {
        // Esconder MAC e playlists
        divMacEspecifico.classList.add('hidden');
        divPlaylists.classList.add('hidden');
        macInput.required = false;

        // Esconder loading indicator (caso esteja visível)
        loadingDominios.classList.add('hidden');

        // Esconder todas as seções de migração inicialmente
        sectionOrigemDiv.classList.add('hidden');
        sectionDestinoDiv.classList.add('hidden');
        sectionSubmitDiv.classList.add('hidden');

        // Carregar domínios (apenas uma vez) - revelará seções progressivamente
        if (!GestaoDNS.dominiosCarregados) {
            carregarDominios();
        } else {
            // Se já carregou antes, mostrar seções imediatamente
            sectionOrigemDiv.classList.remove('hidden');
            sectionDestinoDiv.classList.remove('hidden');
            sectionSubmitDiv.classList.remove('hidden');
        }
    });

    // ===== TOGGLE: Dispositivo específico =====
    tipoEspecifico.addEventListener('change', function() {
        // ===== CAMADA 3: CANCELAR CARREGAMENTO AO TROCAR PARA ESPECÍFICO =====
        if (GestaoDNS.dominiosAbortController) {
            console.log('[DNS] Cancelando carregamento de domínios ao trocar para modo específico');
            GestaoDNS.dominiosAbortController.abort();
            GestaoDNS.isLoadingDominios = false; // Reseta flag manualmente
        }

        // Mostrar APENAS campo MAC
        divMacEspecifico.classList.remove('hidden');
        macInput.required = true;

        // Esconder loading indicator (caso esteja visível)
        loadingDominios.classList.add('hidden');

        // Esconder todas as outras seções
        sectionOrigemDiv.classList.add('hidden');
        sectionDestinoDiv.classList.add('hidden');
        sectionSubmitDiv.classList.add('hidden');
        divPlaylists.classList.add('hidden');
    });

    // ===== EVENT: Buscar dispositivo ao digitar MAC =====
    let macTimeout;
    macInput.addEventListener('input', function() {
        const mac = this.value.trim();

        // Limpar timeout anterior
        clearTimeout(macTimeout);

        // Esperar usuário terminar de digitar (500ms)
        macTimeout = setTimeout(() => {
            if (mac.length === 17) { // MAC completo: XX:XX:XX:XX:XX:XX
                buscarDispositivoPorMAC(mac);
            }
        }, 500);
    });

    // ===== SUBMIT DO FORMULÁRIO =====
    form.addEventListener('submit', function(e) {
        e.preventDefault();

        const tipoMigracao = document.querySelector('input[name="tipo_migracao"]:checked').value;

        // Validações específicas por tipo
        if (tipoMigracao === 'especifico') {
            if (!GestaoDNS.playlistSelecionada) {
                showToast('error', 'Selecione uma playlist para continuar');
                return;
            }
        } else {
            if (!dominioOrigemSelect.value) {
                showToast('error', 'Selecione um domínio origem');
                return;
            }
            GestaoDNS.dominioOrigemAtual = dominioOrigemSelect.value;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;

        // Desabilita botão
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Iniciando...';

        // Montar payload
        const formData = new FormData();
        formData.append('csrfmiddlewaretoken', getCsrfToken());
        formData.append('aplicativo_id', GestaoDNS.aplicativoSelecionado.id);
        formData.append('tipo_migracao', tipoMigracao);
        formData.append('dominio_origem', GestaoDNS.dominioOrigemAtual);
        formData.append('dominio_destino', document.getElementById('dominio-destino').value);

        // ===== OTIMIZAÇÃO: Enviar cache de devices para backend =====
        // Permite backend filtrar devices sem fazer chamadas à API
        if (tipoMigracao === 'todos') {
            const cached = DominiosCache.get(GestaoDNS.aplicativoSelecionado.id);

            if (cached && cached.devices && cached.devices.length > 0) {
                formData.append('cached_devices', JSON.stringify(cached.devices));
                console.log(`[Cache] Enviando ${cached.devices.length} devices em cache para backend (evita ${cached.devices.length} chamadas à API)`);
            } else {
                console.log('[Cache] Nenhum cache disponível, backend usará API');
            }
        }

        if (tipoMigracao === 'especifico') {
            formData.append('mac_alvo', macInput.value);
            formData.append('playlist_id', GestaoDNS.playlistSelecionada.id);
        }

        // Envia requisição
        fetch('/api/gestao-dns/iniciar-migracao/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCsrfToken()
            },
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'iniciado') {
                GestaoDNS.tarefaAtualId = data.tarefa_id;

                showToast('success', data.mensagem);

                // Avança para tela de progresso
                mostrarProgresso();
            } else {
                showToast('error', data.error || 'Erro ao iniciar migração');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        })
        .catch(error => {
            console.error('Erro ao iniciar migração:', error);
            showToast('error', 'Erro ao iniciar migração. Tente novamente.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        });
    });

    // Botão voltar
    document.getElementById('btn-voltar').addEventListener('click', function() {
        showStep('step-select-app');
    });
}

// ==================== ETAPA 5: PROGRESSO ====================

function mostrarProgresso() {
    showStep('step-progresso');

    // Inicia polling
    iniciarPolling();
}

function iniciarPolling() {
    if (GestaoDNS.pollingInterval) {
        clearInterval(GestaoDNS.pollingInterval);
    }

    // Primeira chamada imediata
    consultarProgresso();

    // Polling a cada 3 segundos
    GestaoDNS.pollingInterval = setInterval(() => {
        consultarProgresso();
    }, GestaoDNS.pollingIntervalMs);
}

function consultarProgresso() {
    fetch(`/api/gestao-dns/progresso/${GestaoDNS.tarefaAtualId}/`, {
        method: 'GET',
        headers: {
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        atualizarProgresso(data);

        // Se concluído, para polling
        if (data.concluida) {
            clearInterval(GestaoDNS.pollingInterval);
            mostrarResumo(data);
        }
    })
    .catch(error => {
        console.error('Erro ao consultar progresso:', error);
    });
}

function atualizarProgresso(data) {
    // ===== 1. MENSAGEM DINÂMICA DE PROGRESSO =====
    const progressMessageElement = document.getElementById('progress-message-text');
    const progressMessageDiv = document.getElementById('progress-message');

    if (progressMessageElement && data.mensagem_progresso) {
        progressMessageElement.textContent = data.mensagem_progresso;

        // Muda cor do alert baseado na etapa e resultados
        const etapa = data.etapa_atual || 'iniciando';
        progressMessageDiv.className = 'alert mb-3 text-center';

        if (etapa === 'concluida') {
            // Usar mesma lógica de cor da barra de progresso
            // Verde: 100% sucesso (sucessos > 0 e nenhuma falha)
            if (data.sucessos > 0 && data.falhas === 0) {
                progressMessageDiv.classList.add('alert-success');
            }
            // Amarelo: Sucesso parcial (tem sucessos E falhas) OU todos pulados
            else if ((data.sucessos > 0 && data.falhas > 0) || (data.sucessos === 0 && data.pulados > 0)) {
                progressMessageDiv.classList.add('alert-warning');
            }
            // Vermelho: Todos falharam (nenhum sucesso e tem falhas)
            else {
                progressMessageDiv.classList.add('alert-danger');
            }
        } else if (etapa === 'cancelada') {
            progressMessageDiv.classList.add('alert-danger');
        } else if (etapa === 'analisando') {
            progressMessageDiv.classList.add('alert-info');
        } else if (etapa === 'processando') {
            progressMessageDiv.classList.add('alert-warning');
        } else {
            progressMessageDiv.classList.add('alert-info');
        }
    }

    // ===== 2. BARRA DE PROGRESSO =====
    const percentual = data.progresso_percentual || 0;
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    progressBar.style.width = `${percentual}%`;
    progressText.textContent = `${percentual}%`;

    // Remove classes antigas de cor
    progressBar.classList.remove('bg-primary', 'bg-success', 'bg-danger', 'bg-warning');

    // Define cor baseado no status final
    if (data.concluida) {
        // Remove animação quando concluído
        progressBar.classList.remove('progress-bar-animated');

        const etapa = data.etapa_atual || 'concluida';

        if (etapa === 'concluida') {
            // Verde se teve sucesso (total ou parcial)
            if (data.sucessos > 0 && data.falhas === 0) {
                progressBar.classList.add('bg-success');
            } else if (data.sucessos > 0 && data.falhas > 0) {
                // Amarelo se teve sucessos E falhas
                progressBar.classList.add('bg-warning');
            } else if (data.sucessos === 0 && data.pulados > 0) {
                // Amarelo se todos foram pulados
                progressBar.classList.add('bg-warning');
            } else {
                // Vermelho se todos falharam
                progressBar.classList.add('bg-danger');
            }
        } else if (etapa === 'cancelada') {
            // Vermelho se cancelado
            progressBar.classList.add('bg-danger');
        } else {
            // Padrão
            progressBar.classList.add('bg-primary');
        }
    } else {
        // Durante processamento: azul primário
        progressBar.classList.add('bg-primary');
    }

    // ===== 3. ESTATÍSTICAS =====
    document.getElementById('stat-total').textContent = data.total_dispositivos;
    document.getElementById('stat-processados').textContent = data.processados;
    document.getElementById('stat-sucessos').textContent = data.sucessos;
    document.getElementById('stat-pulados').textContent = data.pulados || 0;
    document.getElementById('stat-falhas').textContent = data.falhas;

    // ===== 4. LOADING INDICATOR =====
    const loadingIndicator = document.getElementById('loading-indicator');
    // Esconde loading se: já carregou dispositivos OU tarefa já concluiu
    if (data.total_dispositivos > 0 || data.concluida === true) {
        loadingIndicator?.classList.add('hidden');
    } else {
        // Mostra loading apenas se ainda em andamento E sem dispositivos
        loadingIndicator?.classList.remove('hidden');
    }

    // ===== 5. TABELA DE DISPOSITIVOS =====
    const tbody = document.getElementById('devices-tbody');
    tbody.innerHTML = '';

    data.dispositivos.forEach(device => {
        const statusIcon = {
            'pendente': '⏳',
            'processando': '🔄',
            'sucesso': '✅',
            'erro': '❌',
            'pulado': '⏭️'
        }[device.status] || '❓';

        const statusClass = {
            'pendente': 'secondary',
            'processando': 'warning',
            'sucesso': 'success',
            'erro': 'danger',
            'pulado': 'info'
        }[device.status] || 'secondary';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><code>${device.device_id}</code></td>
            <td>${device.nome_dispositivo || '-'}</td>
            <td>
                <span class="badge bg-${statusClass} status-badge">
                    <span style="font-size: 1.2em;">${statusIcon}</span> ${device.status}
                </span>
            </td>
            <td><small>${device.dns_encontrado || '-'}</small></td>
            <td><small>${device.dns_atualizado || '-'}</small></td>
            <td><small class="text-danger">${device.mensagem_erro || '-'}</small></td>
        `;
        tbody.appendChild(row);
    });
}

function mostrarResumo(data) {
    const resumoDiv = document.getElementById('resumo-final');
    const resumoTexto = document.getElementById('resumo-texto');
    const resumoAlert = resumoDiv.querySelector('.alert');
    const resumoHeading = resumoDiv.querySelector('.alert-heading');

    const taxaSucesso = data.total_dispositivos > 0
        ? ((data.sucessos / data.total_dispositivos) * 100).toFixed(1)
        : 0;

    // Determinar tipo de resultado
    let mensagemPrincipal, tipologClass, icone;

    if (data.total_dispositivos === 0) {
        // Nenhum dispositivo encontrado
        mensagemPrincipal = 'Nenhum dispositivo encontrado!';
        tipologClass = 'alert-warning';
        icone = 'bi-exclamation-triangle-fill';
    } else if (data.sucessos === 0 && data.falhas === 0) {
        // Todos pulados
        mensagemPrincipal = 'Migração concluída - Todos os dispositivos foram pulados';
        tipologClass = 'alert-info';
        icone = 'bi-info-circle-fill';
    } else if (data.sucessos === 0 && data.falhas > 0) {
        // Todos falharam
        mensagemPrincipal = 'Migração concluída com erros';
        tipologClass = 'alert-danger';
        icone = 'bi-x-circle-fill';
    } else if (data.falhas > 0) {
        // Sucesso parcial
        mensagemPrincipal = 'Migração concluída com ressalvas';
        tipologClass = 'alert-warning';
        icone = 'bi-exclamation-triangle-fill';
    } else {
        // 100% sucesso
        mensagemPrincipal = 'Migração concluída com sucesso!';
        tipologClass = 'alert-success';
        icone = 'bi-check-circle-fill';
    }

    // Atualizar classes do alert
    resumoAlert.className = `alert ${tipologClass}`;

    // Atualizar heading
    resumoHeading.innerHTML = `<i class="bi ${icone} me-2"></i>${mensagemPrincipal}`;

    // Atualizar texto do resumo
    resumoTexto.innerHTML = `
        Total de dispositivos: ${data.total_dispositivos}<br>
        Sucessos: ${data.sucessos} (${taxaSucesso}%)<br>
        Pulados: ${data.pulados || 0}<br>
        Falhas: ${data.falhas}
    `;

    // ===== ATUALIZAÇÃO INTELIGENTE DO CACHE v2.0 =====
    // Ao invés de invalidar, atualiza URLs dos devices no cache
    console.log('[Cache DEBUG] Verificando necessidade de atualização de cache');
    console.log('[Cache DEBUG] GestaoDNS.aplicativoSelecionado:', GestaoDNS.aplicativoSelecionado);

    if (GestaoDNS.aplicativoSelecionado) {
        const appId = GestaoDNS.aplicativoSelecionado.id;

        console.log('[Cache DEBUG] appId:', appId);
        console.log('[Cache DEBUG] data:', {
            total_dispositivos: data.total_dispositivos,
            sucessos: data.sucessos,
            falhas: data.falhas
        });

        // Verificar se é erro crítico que justifica invalidar cache
        const erroCritico = (
            data.total_dispositivos === 0 ||  // Nenhum dispositivo encontrado
            (data.falhas > 0 && data.sucessos === 0)  // Todas as migrações falharam
        );

        console.log('[Cache DEBUG] erroCritico:', erroCritico);

        if (erroCritico) {
            DominiosCache.invalidate(appId);
            console.log('[Cache] Cache invalidado devido a erro crítico na migração');
        } else if (data.sucessos > 0) {
            // Atualizar cache in-memory
            console.log('[Cache DEBUG] CHAMANDO atualizarCacheAposMigracao()...');
            atualizarCacheAposMigracao(appId, data);
            console.log('[Cache DEBUG] atualizarCacheAposMigracao() CONCLUÍDO');
        } else {
            console.log('[Cache DEBUG] Nenhuma atualização necessária (sem sucessos)');
        }
    } else {
        console.log('[Cache DEBUG] Aplicativo não selecionado - não é possível atualizar cache');
    }

    resumoDiv.classList.remove('hidden');

    // Botão nova migração
    document.getElementById('btn-nova-migracao').addEventListener('click', function() {
        location.reload();
    });
}

// ==================== ATUALIZAÇÃO INTELIGENTE DO CACHE ====================

/**
 * Atualiza cache in-memory após migração bem-sucedida (v2.0)
 * Atualiza URLs das playlists sem precisar fazer nova chamada à API
 *
 * @param {Number} appId - ID do aplicativo
 * @param {Object} data - Dados da migração concluída
 */
function atualizarCacheAposMigracao(appId, data) {
    console.log('[Cache DEBUG] ==================== INÍCIO DA ATUALIZAÇÃO ====================');
    console.log('[Cache DEBUG] appId:', appId);
    console.log('[Cache DEBUG] Dados da migração:', data);

    const cached = DominiosCache.get(appId);

    if (!cached || !cached.devices || cached.devices.length === 0) {
        console.log('[Cache DEBUG] Não há devices em cache para atualizar, invalidando');
        DominiosCache.invalidate(appId);
        return;
    }

    console.log('[Cache DEBUG] Cache encontrado:', {
        total_devices: cached.devices.length,
        total_dominios: cached.dominios?.length
    });

    console.log('[Cache] Iniciando atualização inteligente do cache após migração');

    // Criar mapa de dispositivos migrados para acesso rápido
    const dispositivosMigrados = new Map();
    data.dispositivos.forEach(device => {
        if (device.status === 'sucesso') {
            dispositivosMigrados.set(device.device_id, device);
        }
    });

    console.log('[Cache DEBUG] Dispositivos migrados com sucesso:', dispositivosMigrados.size);

    let devicesAtualizados = 0;
    let playlistsAtualizadas = 0;

    // Extrair hostname do domínio de origem para comparação justa
    const dominioOrigemExtraido = DominiosCache._extrairDominioDeUrl(data.dominio_origem);
    const dominioDestinoExtraido = DominiosCache._extrairDominioDeUrl(data.dominio_destino);

    console.log('[Cache DEBUG] Domínio origem (RAW):', data.dominio_origem);
    console.log('[Cache DEBUG] Domínio origem (EXTRAÍDO):', dominioOrigemExtraido);
    console.log('[Cache DEBUG] Domínio destino (RAW):', data.dominio_destino);
    console.log('[Cache DEBUG] Domínio destino (EXTRAÍDO):', dominioDestinoExtraido);

    // Validar que domínios foram extraídos corretamente
    if (!dominioOrigemExtraido || !dominioDestinoExtraido) {
        console.error('[Cache DEBUG] ❌ ERRO: Domínios não puderam ser extraídos!');
        console.error('[Cache DEBUG] Origem RAW:', data.dominio_origem, '→ Extraído:', dominioOrigemExtraido);
        console.error('[Cache DEBUG] Destino RAW:', data.dominio_destino, '→ Extraído:', dominioDestinoExtraido);
        console.error('[Cache DEBUG] Abortando atualização de cache para evitar erros');
        return;
    }

    // Atualizar devices no cache
    console.log('[Cache DEBUG] Processando', cached.devices.length, 'devices no cache');

    cached.devices.forEach((device, index) => {
        const deviceMigrado = dispositivosMigrados.get(device.device_id);

        if (deviceMigrado && device.playlists) {
            console.log(`[Cache DEBUG] Device #${index + 1} (${device.device_id}): ${device.playlists.length} playlists`);

            // Dispositivo foi migrado com sucesso - atualizar suas playlists
            device.playlists.forEach((playlist, pIndex) => {
                const playlistDominio = playlist.dominio?.toLowerCase();
                const match = playlistDominio && dominioOrigemExtraido &&
                              playlistDominio === dominioOrigemExtraido.toLowerCase();

                console.log(`[Cache DEBUG]   Playlist #${pIndex + 1}:`, {
                    dominio: playlist.dominio,
                    dominioOrigemExtraido: dominioOrigemExtraido,
                    match: match,
                    url_preview: playlist.url?.substring(0, 50) + '...'
                });

                // Verificar se playlist contém domínio de origem (comparar apenas hostname)
                if (playlist.dominio && match) {
                    // Substituir domínio na URL (escapar caracteres especiais de regex)
                    const oldUrl = playlist.url;
                    const dominioOrigemEscapado = data.dominio_origem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const newUrl = oldUrl.replace(
                        new RegExp(dominioOrigemEscapado, 'gi'),
                        data.dominio_destino
                    );

                    console.log('[Cache DEBUG]     ✓ ATUALIZANDO:', {
                        oldUrl: oldUrl,
                        newUrl: newUrl,
                        old_dominio: playlist.dominio,
                        new_dominio: dominioDestinoExtraido
                    });

                    // Atualizar playlist
                    playlist.url = newUrl;
                    playlist.dominio = dominioDestinoExtraido;

                    playlistsAtualizadas++;
                }
            });

            devicesAtualizados++;
        } else if (!deviceMigrado) {
            console.log(`[Cache DEBUG] Device #${index + 1} (${device.device_id}): NÃO foi migrado (não está na lista de sucessos)`);
        } else if (!device.playlists) {
            console.log(`[Cache DEBUG] Device #${index + 1} (${device.device_id}): Sem playlists`);
        }
    });

    // Validação: verificar se playlists foram realmente atualizadas
    if (playlistsAtualizadas === 0 && data.sucessos > 0) {
        console.warn('[Cache] ⚠ AVISO: Nenhuma playlist foi atualizada apesar de migrações bem-sucedidas');
        console.warn(`[Cache] Domínio origem: "${data.dominio_origem}" (extraído: "${dominioOrigemExtraido}")`);
        console.warn(`[Cache] Total devices migrados: ${data.sucessos}, Total devices em cache: ${cached.devices.length}`);
        console.warn('[Cache] Possível mismatch de domínios. Invalidando cache para garantir consistência.');
        DominiosCache.invalidate(appId);
        return;
    }

    // Re-extrair domínios dos devices atualizados
    const dominiosAtualizados = DominiosCache._extractDominiosFromDevices(cached.devices);

    console.log('[Cache DEBUG] Domínios após atualização:', dominiosAtualizados.map(d => `${d.dominio} (${d.count})`));

    // Salvar cache atualizado
    DominiosCache.set(
        appId,
        GestaoDNS.aplicativoSelecionado.nome,
        cached.devices,
        dominiosAtualizados
    );

    console.log(`[Cache] ✓ Cache atualizado: ${devicesAtualizados} dispositivos, ${playlistsAtualizadas} playlists alteradas`);
    console.log(`[Cache] ✓ Nova lista de domínios: ${dominiosAtualizados.length} únicos`);
    console.log('[Cache DEBUG] ==================== FIM DA ATUALIZAÇÃO ====================');
}

// ==================== FORÇAR ATUALIZAÇÃO DO CACHE ====================

/**
 * Força atualização do cache, ignorando dados armazenados
 */
async function forcarAtualizacaoCache() {
    if (!GestaoDNS.aplicativoSelecionado) return;

    const appId = GestaoDNS.aplicativoSelecionado.id;

    // Invalida cache
    DominiosCache.invalidate(appId);

    // Reseta flag
    GestaoDNS.dominiosCarregados = false;

    // Desabilita botão durante reload
    const btn = document.getElementById('btn-atualizar-cache');
    if (btn) {
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Atualizando...';

        showToast('info', 'Atualizando lista de domínios...');

        try {
            await carregarDominios();
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    } else {
        // Se botão não existe, apenas recarrega
        showToast('info', 'Atualizando lista de domínios...');
        await carregarDominios();
    }
}

// ==================== MODO DEBUG HEADLESS (Apenas Admin) ====================

async function loadDebugStatus() {
    try {
        const response = await fetch('/api/debug-status/');
        const data = await response.json();

        console.log('Debug Status:', {
            is_admin: data.is_admin,
            debug_mode: data.debug_mode,
            success: data.success
        });

        if (data.is_admin && document.getElementById('btnToggleDebug')) {
            updateDebugButton(data.debug_mode);
        } else if (!data.is_admin) {
            console.warn('Usuário não é admin - botão debug não será inicializado');
        }
    } catch (error) {
        console.error('Erro ao carregar status de debug:', error);
    }
}

async function toggleDebugMode() {
    const btnToggleDebug = document.getElementById('btnToggleDebug');
    if (!btnToggleDebug) return;

    try {
        btnToggleDebug.disabled = true;

        // Debug: verificar CSRF token
        const csrfToken = getCsrfToken();
        console.log('CSRF Token:', csrfToken ? 'OK' : 'AUSENTE');

        const response = await fetch('/api/toggle-debug-headless/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        });

        // Verificar se resposta é JSON ou HTML
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Resposta não-JSON recebida:', text.substring(0, 500));

            if (response.status === 403) {
                showToast('error', 'Permissão negada. Apenas administradores podem alterar o modo debug.');
            } else {
                showToast('error', `Erro HTTP ${response.status}: Resposta inválida do servidor`);
            }
            return;
        }

        const data = await response.json();

        if (data.success) {
            updateDebugButton(data.debug_mode);
            showToast('success', data.mensagem);
        } else {
            showToast('error', data.erro || 'Erro ao alternar modo debug');
        }
    } catch (error) {
        console.error('Erro ao toggle debug:', error);
        showToast('error', 'Erro ao alternar modo debug');
    } finally {
        btnToggleDebug.disabled = false;
    }
}

function updateDebugButton(isActive) {
    const btnToggleDebug = document.getElementById('btnToggleDebug');
    const debugStatusText = document.getElementById('debugStatusText');

    if (!btnToggleDebug || !debugStatusText) return;

    if (isActive) {
        btnToggleDebug.classList.add('active');
        debugStatusText.textContent = 'Debug: ON';
        btnToggleDebug.title = 'Modo Debug ATIVO - Navegador será exibido durante automação';
    } else {
        btnToggleDebug.classList.remove('active');
        debugStatusText.textContent = 'Debug: OFF';
        btnToggleDebug.title = 'Modo Debug DESATIVADO - Navegador oculto (headless)';
    }
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Gestão DNS - Inicializando...');

    // ===== CLEANUP AUTOMÁTICO DO CACHE =====
    // Remove entradas expiradas ao carregar a página
    const removed = DominiosCache.cleanup();
    if (removed > 0) {
        console.log(`[Cache] ${removed} cache(s) expirado(s) removido(s) automaticamente`);
    }

    // Log de estatísticas (modo debug via query param)
    if (window.location.search.includes('debug=cache')) {
        console.log('[Cache] Modo debug ativado - Exibindo estatísticas:');
        console.table(DominiosCache.getStats());
    }

    initAppSelection();
    initLoginForm();
    initMigracaoForm();

    // Inicializar botão de debug (se admin)
    const btnToggleDebug = document.getElementById('btnToggleDebug');
    if (btnToggleDebug) {
        loadDebugStatus();
        btnToggleDebug.addEventListener('click', toggleDebugMode);
    }

    console.log('Gestão DNS - Pronto!');
});
