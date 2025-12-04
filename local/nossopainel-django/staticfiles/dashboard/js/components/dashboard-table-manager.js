/**
 * DashboardTableManager - Gerenciador da tabela de clientes do dashboard
 *
 * Responsabilidades:
 * - Gerenciar busca AJAX de clientes
 * - Integrar ordenação da tabela (TableSortable)
 * - Reinicializar dropdowns após atualizações
 * - Mostrar notificações de feedback
 *
 * @example
 * const manager = new DashboardTableManager();
 * manager.init();
 *
 * // Atualizar tabela programaticamente
 * manager.refreshTable();
 */
class DashboardTableManager {
    /**
     * @param {Object} options - Opções de configuração
     * @param {string} options.containerSelector - Seletor do container da tabela
     * @param {string} options.searchInputSelector - Seletor do input de busca
     * @param {string} options.tableSelector - Seletor da tabela
     * @param {number} options.searchDelay - Delay da busca em ms
     * @param {string} options.searchUrl - URL para busca AJAX
     */
    constructor(options = {}) {
        this.options = {
            containerSelector: '#tabela-container',
            searchInputSelector: '#searchInput',
            tableSelector: '#myTable',
            searchDelay: 400,
            searchUrl: '/dashboard/busca/',
            ...options
        };

        this.container = null;
        this.searchInput = null;
        this.sortable = null;
        this.searchTimeout = null;
        this.isInitialized = false;
        this.currentPage = 1; // Rastreia página atual
        this.currentSearchTerm = ''; // Rastreia termo de busca atual
    }

    /**
     * Inicializa o gerenciador
     * @returns {boolean} True se inicializado com sucesso
     */
    init() {
        // Obtém referências aos elementos
        this.container = document.querySelector(this.options.containerSelector);
        this.searchInput = document.querySelector(this.options.searchInputSelector);

        if (!this.container) {
            console.error(`[DashboardTableManager] Container não encontrado: ${this.options.containerSelector}`);
            return false;
        }

        if (!this.searchInput) {
            console.warn(`[DashboardTableManager] Input de busca não encontrado: ${this.options.searchInputSelector}`);
            // Continua mesmo sem busca
        }

        // Inicializa componentes da tabela
        this.initTable();

        // Anexa listener de busca se input existe
        if (this.searchInput) {
            this.attachSearchListener();
        }

        // Anexa listeners de paginação
        this.attachPaginationListeners();

        this.isInitialized = true;
        console.debug('[DashboardTableManager] Inicializado com sucesso');

        return true;
    }

    /**
     * Inicializa os componentes da tabela (ordenação e dropdowns)
     * @private
     */
    initTable() {
        // Inicializa ou reinicializa ordenação
        if (this.sortable) {
            console.debug('[DashboardTableManager] Reinicializando ordenação da tabela');
            this.sortable.reinit();

            // CRUCIAL: Reaplica ordenação após AJAX
            if (this.sortable.hasSortState()) {
                console.debug('[DashboardTableManager] Reaplicando ordenação anterior');
                this.sortable.reapplySort();
            }
        } else {
            console.debug('[DashboardTableManager] Criando nova instância de TableSortable');
            this.sortable = new TableSortable(this.options.tableSelector, {
                defaultOrder: 'desc',
                locale: 'pt-BR'
            });
            this.sortable.init();
        }

        // Inicializa dropdowns (usa função global existente)
        if (typeof window.initializeTableDropdowns === 'function') {
            console.debug('[DashboardTableManager] Inicializando dropdowns da tabela');
            window.initializeTableDropdowns();
        } else {
            console.warn('[DashboardTableManager] Função initializeTableDropdowns não encontrada');
        }

        // Reinicializa tooltips Bootstrap após AJAX
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(function (tooltipTriggerEl) {
                // Destrói tooltip existente se houver
                const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
                // Cria novo tooltip
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
            console.debug('[DashboardTableManager] Tooltips reinicializados');
        }
    }

    /**
     * Anexa listener ao input de busca
     * @private
     */
    attachSearchListener() {
        this.searchInput.addEventListener('input', (event) => {
            const searchTerm = event.target.value.trim();

            // Limpa timeout anterior
            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }

            // Agenda nova busca com delay
            this.searchTimeout = setTimeout(() => {
                this.currentPage = 1; // Reset página ao buscar
                this.performSearch(searchTerm);
            }, this.options.searchDelay);
        });

        console.debug('[DashboardTableManager] Listener de busca anexado');
    }

    /**
     * Anexa listeners aos links de paginação usando event delegation
     * @private
     */
    attachPaginationListeners() {
        // Event delegation no container (funciona mesmo após AJAX)
        this.container.addEventListener('click', (event) => {
            // Verifica se clicou em um link de paginação
            const pageLink = event.target.closest('.pagination .page-link[data-page]');

            if (pageLink) {
                event.preventDefault(); // Impede reload da página

                const page = parseInt(pageLink.dataset.page, 10);

                if (!isNaN(page) && page !== this.currentPage) {
                    this.goToPage(page);
                }
            }
        });

        console.debug('[DashboardTableManager] Listener de paginação anexado (event delegation)');
    }

    /**
     * Navega para uma página específica
     * @param {number} page - Número da página
     * @returns {Promise<void>}
     */
    async goToPage(page) {
        console.debug(`[DashboardTableManager] Navegando para página ${page}`);

        this.currentPage = page;
        return this.performSearch(this.currentSearchTerm, page);
    }

    /**
     * Executa busca AJAX de clientes
     * @param {string} searchTerm - Termo de busca
     * @param {number} page - Número da página (padrão: 1)
     * @returns {Promise<void>}
     */
    async performSearch(searchTerm, page = 1) {
        try {
            // Atualiza estado
            this.currentSearchTerm = searchTerm;
            this.currentPage = page;

            console.debug(`[DashboardTableManager] Buscando: "${searchTerm}" (página ${page})`);

            // Mostra feedback de carregamento
            this.showToast('Buscando clientes...', 'info');

            // Constrói URL com busca e página
            const params = new URLSearchParams();
            if (searchTerm) {
                params.append('q', searchTerm);
            }
            if (page > 1) {
                params.append('page', page);
            }

            const url = `${this.options.searchUrl}?${params.toString()}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();

            // Substitui conteúdo da tabela
            this.container.innerHTML = html;

            // Reinicializa componentes (CRUCIAL para resolver o bug)
            this.initTable();

            // Atualiza URL do navegador (history API)
            this.updateBrowserUrl(searchTerm, page);

            // Scroll suave para o topo da tabela
            this.scrollToTable();

            // Feedback de sucesso
            this.showToast('Tabela atualizada!', 'success');

            console.debug('[DashboardTableManager] Busca concluída com sucesso');

        } catch (error) {
            console.error('[DashboardTableManager] Erro ao buscar clientes:', error);
            this.showToast('Erro ao buscar clientes!', 'error');
        }
    }

    /**
     * Atualiza a tabela mantendo o termo de busca e página atuais
     * @returns {Promise<void>}
     */
    async refreshTable() {
        console.debug(`[DashboardTableManager] Atualizando tabela (termo: "${this.currentSearchTerm}", página: ${this.currentPage})`);

        return this.performSearch(this.currentSearchTerm, this.currentPage);
    }

    /**
     * Atualiza URL do navegador sem recarregar a página
     * @private
     * @param {string} searchTerm - Termo de busca
     * @param {number} page - Número da página
     */
    updateBrowserUrl(searchTerm, page) {
        const params = new URLSearchParams();

        if (searchTerm) {
            params.append('q', searchTerm);
        }

        if (page > 1) {
            params.append('page', page);
        }

        const newUrl = params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;

        // Atualiza URL sem recarregar (History API)
        window.history.pushState({ searchTerm, page }, '', newUrl);

        console.debug(`[DashboardTableManager] URL atualizada: ${newUrl}`);
    }

    /**
     * Faz scroll suave para o topo da tabela
     * @private
     */
    scrollToTable() {
        if (this.container) {
            this.container.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }

    /**
     * Mostra notificação toast
     * @private
     * @param {string} message - Mensagem a exibir
     * @param {string} type - Tipo: 'info', 'success' ou 'error'
     */
    showToast(message, type = 'info') {
        // Usa função global do toast-manager.js
        if (typeof window.showToast === 'function') {
            // Nova assinatura: showToast(type, message, options)
            window.showToast(type, message);
        } else {
            // Fallback simples
            console.log(`[Toast ${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Limpa o input de busca e atualiza a tabela
     */
    clearSearch() {
        if (this.searchInput) {
            this.searchInput.value = '';
            this.performSearch('');
        }
    }

    /**
     * Limpa ordenação e reseta tabela
     */
    clearSort() {
        if (this.sortable) {
            this.sortable.clearSortState();
            this.refreshTable();
        }
    }

    /**
     * Obtém estado atual de ordenação
     * @returns {Object|null}
     */
    getSortState() {
        return this.sortable ? this.sortable.getSortState() : null;
    }

    /**
     * Verifica se o gerenciador está pronto
     * @returns {boolean}
     */
    isReady() {
        return this.isInitialized && this.container !== null;
    }

    /**
     * Destrói o gerenciador e limpa recursos
     */
    destroy() {
        console.debug('[DashboardTableManager] Destruindo gerenciador');

        // Limpa timeout pendente
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }

        // Destrói sortable
        if (this.sortable) {
            this.sortable.destroy();
            this.sortable = null;
        }

        // Limpa referências
        this.container = null;
        this.searchInput = null;
        this.isInitialized = false;
    }
}

// Exporta para uso global
if (typeof window !== 'undefined') {
    window.DashboardTableManager = DashboardTableManager;
}

// Suporte a módulos ES6
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DashboardTableManager;
}
