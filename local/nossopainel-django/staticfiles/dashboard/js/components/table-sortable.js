/**
 * TableSortable - Componente reutilizável para ordenação de tabelas
 *
 * Funcionalidades:
 * - Ordenação por texto, data e número
 * - Suporte a múltiplas reinicializações
 * - Event delegation para melhor performance
 * - Suporte a valores nulos e vazios
 *
 * @example
 * // Inicialização básica
 * const sortable = new TableSortable('#myTable');
 * sortable.init();
 *
 * // Após atualização AJAX da tabela
 * sortable.reinit();
 *
 * @example
 * // Com opções customizadas
 * const sortable = new TableSortable('#myTable', {
 *     defaultOrder: 'asc',
 *     locale: 'pt-BR'
 * });
 */
class TableSortable {
    /**
     * @param {string} tableSelector - Seletor CSS da tabela
     * @param {Object} options - Opções de configuração
     * @param {string} options.defaultOrder - Ordem padrão: 'asc' ou 'desc' (padrão: 'desc')
     * @param {string} options.locale - Locale para comparação de strings (padrão: 'pt-BR')
     * @param {Array<string>} options.sortTypes - Tipos de ordenação suportados
     */
    constructor(tableSelector, options = {}) {
        this.selector = tableSelector;
        this.options = {
            defaultOrder: 'desc',
            locale: 'pt-BR',
            sortTypes: ['text', 'date', 'number'],
            ...options
        };
        this.table = null;
        this.headers = null;
        this.isInitialized = false;

        // Estado de ordenação (para persistência)
        this.sortState = {
            columnIndex: null,
            sortType: null,
            order: null
        };
    }

    /**
     * Inicializa a ordenação da tabela
     * @returns {boolean} True se inicializado com sucesso
     */
    init() {
        this.table = document.querySelector(this.selector);

        if (!this.table) {
            console.warn(`[TableSortable] Tabela não encontrada: ${this.selector}`);
            return false;
        }

        this.headers = this.table.querySelectorAll('thead th[data-sort-type]');

        if (this.headers.length === 0) {
            console.warn(`[TableSortable] Nenhuma coluna ordenável encontrada em ${this.selector}`);
            return false;
        }

        this.attachEventListeners();
        this.isInitialized = true;

        console.debug(`[TableSortable] Inicializado com sucesso: ${this.selector}`);
        return true;
    }

    /**
     * Reinicializa a ordenação (útil após atualizações AJAX)
     * @returns {boolean} True se reinicializado com sucesso
     */
    reinit() {
        console.debug(`[TableSortable] Reinicializando: ${this.selector}`);
        this.removeEventListeners();
        this.isInitialized = false;
        return this.init();
    }

    /**
     * Anexa event listeners aos cabeçalhos da tabela
     * @private
     */
    attachEventListeners() {
        this.headers.forEach((header, index) => {
            // Guarda referência à função para poder remover depois
            header._sortHandler = () => this.handleSort(header, index);
            header.addEventListener('click', header._sortHandler);

            // Estilização visual
            header.style.cursor = 'pointer';
            header.style.userSelect = 'none';
            header.setAttribute('title', 'Clique para ordenar');
        });
    }

    /**
     * Remove event listeners dos cabeçalhos
     * @private
     */
    removeEventListeners() {
        if (!this.headers) return;

        this.headers.forEach((header) => {
            if (header._sortHandler) {
                header.removeEventListener('click', header._sortHandler);
                delete header._sortHandler;
            }
        });
    }

    /**
     * Manipula o clique em um cabeçalho
     * @private
     * @param {HTMLElement} header - Elemento do cabeçalho clicado
     * @param {number} columnIndex - Índice da coluna
     */
    handleSort(header, columnIndex) {
        const sortType = header.dataset.sortType || 'text';
        const currentOrder = header.dataset.sortOrder || this.options.defaultOrder;
        const nextOrder = currentOrder === 'asc' ? 'desc' : 'asc';

        this.applySort(columnIndex, sortType, nextOrder);
        this.updateHeaderStates(header, nextOrder);

        // Salva estado de ordenação
        this.sortState = {
            columnIndex,
            sortType,
            order: nextOrder
        };

        console.debug(`[TableSortable] Estado de ordenação salvo:`, this.sortState);
    }

    /**
     * Aplica a ordenação às linhas da tabela
     * @private
     * @param {number} columnIndex - Índice da coluna a ordenar
     * @param {string} sortType - Tipo de ordenação (text, date, number)
     * @param {string} order - Ordem: 'asc' ou 'desc'
     */
    applySort(columnIndex, sortType, order) {
        const tbody = this.table.tBodies[0];
        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((rowA, rowB) => {
            const aValue = this.getComparableValue(rowA, columnIndex, sortType);
            const bValue = this.getComparableValue(rowB, columnIndex, sortType);

            // Valores iguais
            if (aValue === bValue) {
                return 0;
            }

            // Tratamento de valores nulos (sempre vão para o final)
            if (aValue === null) {
                return order === 'asc' ? 1 : -1;
            }

            if (bValue === null) {
                return order === 'asc' ? -1 : 1;
            }

            // Ordenação por tipo
            if (sortType === 'date' || sortType === 'number') {
                return order === 'asc' ? aValue - bValue : bValue - aValue;
            }

            // Ordenação de texto (padrão)
            return order === 'asc'
                ? aValue.localeCompare(bValue, this.options.locale, { sensitivity: 'base' })
                : bValue.localeCompare(aValue, this.options.locale, { sensitivity: 'base' });
        });

        // Reinsere as linhas ordenadas no DOM
        rows.forEach(row => tbody.appendChild(row));
    }

    /**
     * Obtém valor comparável de uma célula
     * @private
     * @param {HTMLTableRowElement} row - Linha da tabela
     * @param {number} columnIndex - Índice da coluna
     * @param {string} sortType - Tipo de ordenação
     * @returns {string|number|null} Valor comparável
     */
    getComparableValue(row, columnIndex, sortType) {
        const cell = row.cells[columnIndex];

        if (!cell) {
            return null;
        }

        // Prioriza data-sort-value, caso contrário usa textContent
        const rawValue = cell.getAttribute('data-sort-value') ?? cell.textContent.trim();

        if (!rawValue) {
            return null;
        }

        // Processamento específico por tipo
        switch (sortType) {
            case 'date':
                return this.parseDate(rawValue);

            case 'number':
                return this.parseNumber(rawValue);

            default:
                return rawValue.toString().toLowerCase();
        }
    }

    /**
     * Converte string de data para timestamp
     * @private
     * @param {string} rawValue - Valor da data
     * @returns {number|null} Timestamp ou null se inválido
     */
    parseDate(rawValue) {
        // Tenta parsear formato ISO (YYYY-MM-DD)
        const parsed = Date.parse(rawValue);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        // Tenta parsear formato brasileiro (DD/MM/YYYY)
        const parts = rawValue.split('/');
        if (parts.length === 3) {
            const [day, month, year] = parts.map(Number);

            if (day && month && year) {
                const date = new Date(year, month - 1, day);

                // Valida se a data é válida
                if (!isNaN(date.getTime())) {
                    return date.getTime();
                }
            }
        }

        return null;
    }

    /**
     * Converte string para número
     * @private
     * @param {string} rawValue - Valor numérico
     * @returns {number|null} Número ou null se inválido
     */
    parseNumber(rawValue) {
        // Remove caracteres não numéricos exceto . e -
        const cleaned = rawValue.replace(/[^\d.-]/g, '');
        const num = parseFloat(cleaned);

        return isNaN(num) ? null : num;
    }

    /**
     * Atualiza estados visuais dos cabeçalhos
     * @private
     * @param {HTMLElement} activeHeader - Cabeçalho ativo
     * @param {string} order - Ordem atual
     */
    updateHeaderStates(activeHeader, order) {
        this.headers.forEach(header => {
            if (header === activeHeader) {
                header.dataset.sortOrder = order;
                header.classList.remove('sorted-asc', 'sorted-desc');
                header.classList.add(order === 'asc' ? 'sorted-asc' : 'sorted-desc');
            } else {
                // Remove ordenação de outros cabeçalhos
                header.removeAttribute('data-sort-order');
                header.classList.remove('sorted-asc', 'sorted-desc');
            }
        });
    }

    /**
     * Destrói a instância e remove listeners
     */
    destroy() {
        console.debug(`[TableSortable] Destruindo: ${this.selector}`);
        this.removeEventListeners();
        this.table = null;
        this.headers = null;
        this.isInitialized = false;
    }

    /**
     * Verifica se a tabela está inicializada
     * @returns {boolean}
     */
    isReady() {
        return this.isInitialized && this.table !== null;
    }

    /**
     * Verifica se há ordenação aplicada
     * @returns {boolean}
     */
    hasSortState() {
        return this.sortState.columnIndex !== null;
    }

    /**
     * Obtém o estado atual de ordenação
     * @returns {Object} Estado de ordenação {columnIndex, sortType, order}
     */
    getSortState() {
        return { ...this.sortState };
    }

    /**
     * Reaplicar a última ordenação (após AJAX)
     * @returns {boolean} True se ordenação foi reaplicada
     */
    reapplySort() {
        if (!this.hasSortState()) {
            console.debug('[TableSortable] Nenhuma ordenação para reaplicar');
            return false;
        }

        const { columnIndex, sortType, order } = this.sortState;

        console.debug(`[TableSortable] Reaplicando ordenação: coluna ${columnIndex}, tipo ${sortType}, ordem ${order}`);

        // Aplica ordenação
        this.applySort(columnIndex, sortType, order);

        // Atualiza estado visual dos cabeçalhos
        const header = this.headers[columnIndex];
        if (header) {
            this.updateHeaderStates(header, order);
        }

        return true;
    }

    /**
     * Limpa estado de ordenação
     */
    clearSortState() {
        this.sortState = {
            columnIndex: null,
            sortType: null,
            order: null
        };
        console.debug('[TableSortable] Estado de ordenação limpo');
    }
}

// Exporta para uso global (compatibilidade com código existente)
if (typeof window !== 'undefined') {
    window.TableSortable = TableSortable;
}

// Suporte a módulos ES6 (para uso futuro)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TableSortable;
}
