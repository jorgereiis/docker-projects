/**
 * Toast Manager - Centralized Toast Notification System
 *
 * Uses SweetAlert2 library in toast mode for consistent, professional notifications
 * across the entire application.
 *
 * @requires SweetAlert2 v11.1.4+ (loaded globally via templates/partials/scripts.html)
 * @author IPTV Management System
 * @version 1.0.0
 */

(function(window) {
    'use strict';

    /**
     * Display a toast notification
     *
     * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
     * @param {string} message - Message to display (plain text or HTML)
     * @param {Object} options - Optional configuration
     * @param {number} options.duration - Toast duration in milliseconds (default: 3500)
     * @param {boolean} options.showProgressBar - Show countdown timer bar (default: true)
     * @param {string} options.position - Position: 'top-end', 'top-start', 'bottom-end', etc. (default: 'top-end')
     * @param {boolean} options.showCloseButton - Show manual close button (default: false)
     * @param {string} options.title - Custom title (overrides default by type)
     * @param {Function} options.onClose - Callback when toast closes
     *
     * @example
     * showToast('success', 'Cliente salvo com sucesso!');
     * showToast('error', 'Erro ao salvar cliente', { duration: 5000 });
     * showToast('warning', 'Atenção: dados não sincronizados', { showCloseButton: true });
     * showToast('info', 'Processando...', { duration: 10000, showProgressBar: true });
     */
    window.showToast = function(type, message, options = {}) {
        // Check if SweetAlert2 is available
        if (typeof Swal === 'undefined') {
            console.error('SweetAlert2 is not loaded. Cannot display toast notification.');
            // Fallback to native alert (better than nothing)
            alert(message);
            return;
        }

        // Validate type parameter
        const validTypes = ['success', 'error', 'warning', 'info', 'question'];
        if (!validTypes.includes(type)) {
            console.warn(`Invalid toast type "${type}". Using "info" as fallback.`);
            type = 'info';
        }

        // Default configuration
        const defaults = {
            duration: 3500,           // 3.5 seconds
            showProgressBar: true,
            position: 'top-end',      // top-right corner
            showCloseButton: false,
            title: null,
            onClose: null
        };

        // Merge options with defaults
        const config = { ...defaults, ...options };

        // Auto-generate title based on type if not provided
        const defaultTitles = {
            'success': 'Sucesso!',
            'error': 'Erro!',
            'warning': 'Atenção!',
            'info': 'Informação',
            'question': 'Confirme'
        };

        const title = config.title || defaultTitles[type];

        // Build SweetAlert2 configuration
        const swalConfig = {
            toast: true,
            position: config.position,
            icon: type,
            title: title,
            text: message,
            showConfirmButton: false,
            timer: config.duration,
            timerProgressBar: config.showProgressBar,
            showCloseButton: config.showCloseButton,
            didClose: config.onClose,
            // Custom styling for better appearance
            customClass: {
                popup: 'toast-popup-custom',
                title: 'toast-title-custom',
                icon: 'toast-icon-custom'
            },
            // Allow clicking outside to dismiss
            allowOutsideClick: true,
            // Prevent toast from pausing on hover (can be changed if needed)
            didOpen: (toast) => {
                // Optional: pause timer on hover
                // toast.addEventListener('mouseenter', Swal.stopTimer);
                // toast.addEventListener('mouseleave', Swal.resumeTimer);
            }
        };

        // Fire the toast
        Swal.fire(swalConfig);
    };

    /**
     * Shorthand methods for common toast types
     */
    window.showToast.success = function(message, options = {}) {
        window.showToast('success', message, options);
    };

    window.showToast.error = function(message, options = {}) {
        window.showToast('error', message, options);
    };

    window.showToast.warning = function(message, options = {}) {
        window.showToast('warning', message, options);
    };

    window.showToast.info = function(message, options = {}) {
        window.showToast('info', message, options);
    };

    /**
     * Display a loading toast (no auto-dismiss)
     * Returns the Swal instance so it can be closed programmatically
     *
     * @param {string} message - Loading message
     * @returns {Promise} SweetAlert2 promise
     *
     * @example
     * const loadingToast = showLoadingToast('Processando...');
     * // ... do async work ...
     * Swal.close();
     * showToast('success', 'Concluído!');
     */
    window.showLoadingToast = function(message = 'Carregando...') {
        if (typeof Swal === 'undefined') {
            console.error('SweetAlert2 is not loaded.');
            return;
        }

        return Swal.fire({
            toast: true,
            position: 'top-end',
            title: message,
            showConfirmButton: false,
            allowOutsideClick: false,
            allowEscapeKey: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    };

    /**
     * Display a confirmation dialog (not toast, but related utility)
     *
     * @param {string} title - Confirmation title
     * @param {string} message - Confirmation message
     * @param {Object} options - Optional configuration
     * @returns {Promise<boolean>} True if confirmed, false if cancelled
     *
     * @example
     * const confirmed = await showConfirm('Excluir cliente?', 'Esta ação não pode ser desfeita.');
     * if (confirmed) {
     *     // proceed with deletion
     * }
     */
    window.showConfirm = async function(title, message, options = {}) {
        if (typeof Swal === 'undefined') {
            console.error('SweetAlert2 is not loaded.');
            return window.confirm(title + '\n' + message);
        }

        const result = await Swal.fire({
            title: title,
            text: message,
            icon: options.icon || 'warning',
            showCancelButton: true,
            confirmButtonColor: options.confirmColor || '#3085d6',
            cancelButtonColor: options.cancelColor || '#d33',
            confirmButtonText: options.confirmText || 'Sim, confirmar',
            cancelButtonText: options.cancelText || 'Cancelar',
            reverseButtons: true
        });

        return result.isConfirmed;
    };

    // Log initialization
    console.log('Toast Manager initialized successfully.');

})(window);
