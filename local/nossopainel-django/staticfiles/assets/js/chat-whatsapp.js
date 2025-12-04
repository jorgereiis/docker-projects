/**
 * Chat WhatsApp - JavaScript
 * Gerencia a interface de chat similar ao WhatsApp Web
 */

(function() {
    'use strict';

    // Estado do chat
    let currentChat = null;
    let currentPhone = null;
    let replyToMessageId = null;
    let lastMessagesHash = null; // Para comparar se houve mudanças
    let isFirstLoad = true; // Flag para saber se é primeiro carregamento
    let currentFilter = 'all'; // Filtro atual: 'all' ou 'unread'
    const DEFAULT_AVATAR = '/static/assets/images/avatar/default-avatar.svg';

    // Sessão ativa (definida pelo backend via window.CHAT_SESSION)
    const currentSession = window.CHAT_SESSION || null;

    // === SSE (Server-Sent Events) ===
    let eventSource = null;
    let sseReconnectTimeout = null;
    let sseReconnectAttempts = 0;
    const SSE_RECONNECT_DELAY_BASE = 1000;  // 1 segundo inicial
    const SSE_RECONNECT_DELAY_MAX = 30000;  // Máximo 30 segundos
    const SSE_MAX_FAILURES = 5;  // Após 5 falhas, ativar polling de fallback
    let sseConnected = false;
    let fallbackPollingActive = false;

    // Polling para desenvolvimento (localhost)
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let devPollingInterval = null;
    const DEV_POLLING_INTERVAL = 10000;  // 10 segundos em desenvolvimento

    // Controle de marcação como lida (debounce)
    let markAsReadTimeout = null;
    const MARK_AS_READ_DELAY = 2000;  // 2 segundos de debounce

    // Cache de fotos de perfil para evitar requisições repetidas
    const profilePicCache = new Map();

    // Elementos DOM
    const chatList = document.getElementById('chat-list');
    const messagesContainer = document.getElementById('messages-container');
    const noChatSelected = document.getElementById('no-chat-selected');
    const activeChat = document.getElementById('active-chat');
    const chatAvatar = document.getElementById('chat-avatar');
    const chatName = document.getElementById('chat-name');
    const chatStatus = document.getElementById('chat-status');
    const messageInput = document.getElementById('message-input');
    const formSendMessage = document.getElementById('form-send-message');
    const searchInput = document.getElementById('search-contact');
    const fileInput = document.getElementById('file-input');
    const replyPreview = document.getElementById('reply-preview');
    const replyText = document.getElementById('reply-text');
    const chatSidebar = document.getElementById('chat-sidebar');

    // Inicializacao
    document.addEventListener('DOMContentLoaded', init);

    // === Sistema de Emojis Apple Style ===
    // Usa sprite sheet do emoji-datasource-apple para renderização idêntica ao WhatsApp/iOS
    let emojiDataLoaded = false;
    const emojiMap = new Map();  // Mapa unified code -> {sheet_x, sheet_y}
    const EMOJI_SPRITE_SIZE = 64;  // Tamanho de cada emoji no sprite (64px)
    const EMOJI_DISPLAY_SIZE = 20; // Tamanho de exibição padrão
    const SPRITE_COLS = 61;  // Colunas no sprite sheet
    const SPRITE_ROWS = 62;  // Linhas no sprite sheet

    // Carregar dados de emoji do JSON
    async function loadEmojiData() {
        if (emojiDataLoaded) return;

        try {
            const response = await fetch('/static/assets/emoji/emoji.json');
            const data = await response.json();

            // Criar mapa de acesso rápido: unified code -> posição no sprite
            data.forEach(emoji => {
                if (emoji.has_img_apple) {
                    // Normalizar unified code (uppercase, com hífens)
                    const unified = emoji.unified.toUpperCase();
                    emojiMap.set(unified, {
                        x: emoji.sheet_x,
                        y: emoji.sheet_y,
                        short_name: emoji.short_name
                    });

                    // Também mapear versão sem FE0F (variation selector)
                    const withoutVS = unified.replace(/-FE0F/g, '');
                    if (withoutVS !== unified) {
                        emojiMap.set(withoutVS, {
                            x: emoji.sheet_x,
                            y: emoji.sheet_y,
                            short_name: emoji.short_name
                        });
                    }
                }
            });

            emojiDataLoaded = true;
            console.log(`[Emoji] ✓ Carregados ${emojiMap.size} emojis Apple`);
        } catch (error) {
            console.warn('[Emoji] Falha ao carregar dados:', error.message);
            // Fallback: manter emojis nativos
        }
    }

    // Converter emoji Unicode para unified code (ex: "😀" -> "1F600")
    function emojiToUnified(emoji) {
        return [...emoji]
            .map(char => char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
            .join('-');
    }

    // Renderizar um emoji como span com background do sprite
    function renderAppleEmoji(unified) {
        const data = emojiMap.get(unified);
        if (!data) return null;

        const x = data.x * EMOJI_SPRITE_SIZE;
        const y = data.y * EMOJI_SPRITE_SIZE;

        // Calcular escala do background para manter proporção
        const scale = EMOJI_DISPLAY_SIZE / EMOJI_SPRITE_SIZE;
        const bgWidth = SPRITE_COLS * EMOJI_SPRITE_SIZE * scale;
        const bgHeight = SPRITE_ROWS * EMOJI_SPRITE_SIZE * scale;
        const bgX = x * scale;
        const bgY = y * scale;

        return `<span class="apple-emoji" style="background-position: -${bgX}px -${bgY}px; background-size: ${bgWidth}px ${bgHeight}px;" title="${data.short_name || ''}"></span>`;
    }

    // Regex para detectar emojis Unicode (ampla cobertura)
    const emojiRegex = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Component})+/gu;

    // Aplicar emojis Apple em um elemento (substitui emojis Unicode por sprites)
    function applyAppleEmoji(element) {
        if (!element || !emojiDataLoaded) return;

        // Processar todos os nós de texto dentro do elemento
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        textNodes.forEach(node => {
            const text = node.textContent;
            if (!text || !emojiRegex.test(text)) return;

            // Reset regex
            emojiRegex.lastIndex = 0;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = emojiRegex.exec(text)) !== null) {
                // Adicionar texto antes do emoji
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                // Converter emoji para sprite
                const emoji = match[0];
                const unified = emojiToUnified(emoji);
                const rendered = renderAppleEmoji(unified);

                if (rendered) {
                    // Criar span com o emoji renderizado
                    const temp = document.createElement('span');
                    temp.innerHTML = rendered;
                    fragment.appendChild(temp.firstChild);
                } else {
                    // Fallback: manter emoji nativo
                    fragment.appendChild(document.createTextNode(emoji));
                }

                lastIndex = match.index + match[0].length;
            }

            // Adicionar texto restante
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            // Substituir nó de texto pelo fragmento processado
            if (fragment.childNodes.length > 0) {
                node.parentNode.replaceChild(fragment, node);
            }
        });
    }

    // Função de compatibilidade (substitui applyTwemoji)
    function applyTwemoji(element) {
        applyAppleEmoji(element);
    }

    // Polling desabilitado - usamos arquitetura event-driven via Webhook → SSE
    // Dados são atualizados apenas quando:
    // 1. Página é carregada/recarregada
    // 2. Um chat é selecionado
    // 3. Webhook envia evento via SSE (nova mensagem, ack, etc.)
    let pollingInterval = null; // Mantido para compatibilidade, mas não usado

    async function init() {
        // Verificar se elementos existem (pagina de chat esta carregada)
        if (!chatList) return;

        // Carregar dados de emoji antes de renderizar conteúdo
        await loadEmojiData();

        loadChatList();  // Carrega lista apenas uma vez ao abrir a página
        setupEventListeners();
        connectSSE();  // SSE para receber eventos em tempo real (via webhook)
        setupVisibilityChange();

        // Em localhost (desenvolvimento), ativar polling como complemento ao SSE
        // (Django runserver tem buffering que atrasa eventos SSE)
        if (isLocalhost) {
            console.log('[Chat] 🔧 Ambiente de desenvolvimento detectado - polling ativado (10s)');
            startDevPolling();
        }

        // Solicitar permissao para notificacoes
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // Inicializar icones feather apos carregamento
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    function setupEventListeners() {
        // Enviar mensagem
        formSendMessage?.addEventListener('submit', handleSendMessage);

        // Auto-resize textarea
        messageInput?.addEventListener('input', autoResizeTextarea);

        // Enter para enviar (Shift+Enter para nova linha)
        messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                formSendMessage.dispatchEvent(new Event('submit'));
            }
        });

        // Busca de conversas
        searchInput?.addEventListener('input', filterChats);

        // Filtros de chat (Tudo / Não lidas)
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                applyFilter(btn.dataset.filter);
            });
        });

        // Anexar arquivos
        document.getElementById('btn-attach-image')?.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.accept = 'image/*';
            fileInput.dataset.type = 'image';
            fileInput.click();
        });

        document.getElementById('btn-attach-file')?.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.accept = '*/*';
            fileInput.dataset.type = 'file';
            fileInput.click();
        });

        document.getElementById('btn-attach-audio')?.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.accept = 'audio/*';
            fileInput.dataset.type = 'audio';
            fileInput.click();
        });

        fileInput?.addEventListener('change', handleFileUpload);

        // Cancelar reply
        document.getElementById('btn-cancel-reply')?.addEventListener('click', cancelReply);

        // Atualizar mensagens manualmente
        document.getElementById('btn-refresh-messages')?.addEventListener('click', () => {
            if (currentPhone) loadMessages(currentPhone);
        });

        // Mobile: mostrar/esconder sidebar
        document.getElementById('btn-show-sidebar')?.addEventListener('click', () => {
            chatSidebar?.classList.remove('hidden');
        });

        document.getElementById('btn-close-sidebar')?.addEventListener('click', () => {
            chatSidebar?.classList.add('hidden');
        });

        // ESC para fechar conversa aberta
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && currentPhone) {
                closeChat();
            }
        });
    }

    // Carrega lista de conversas
    async function loadChatList() {
        try {
            console.log('[Chat] Carregando lista de conversas...');
            const response = await fetch('/api/chat/list/');
            console.log('[Chat] Response status:', response.status);
            const data = await response.json();
            console.log('[Chat] Data received:', data);
            console.log('[Chat] Is array:', Array.isArray(data));

            if (response.ok && Array.isArray(data)) {
                console.log('[Chat] Renderizando', data.length, 'conversas');
                renderChatList(data);
            } else {
                console.log('[Chat] Erro - data.error:', data.error);
                chatList.innerHTML = `<div class="text-center py-5 text-danger">
                    <i data-feather="alert-circle" class="mb-2"></i>
                    <p>${data.error || 'Erro ao carregar conversas'}</p>
                </div>`;
            }
        } catch (error) {
            console.error('[Chat] Erro ao carregar lista de chats:', error);
            chatList.innerHTML = `<div class="text-center py-5 text-danger">
                <i data-feather="wifi-off" class="mb-2"></i>
                <p>Erro de conexao</p>
            </div>`;
        }

        // Atualizar icones
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    // Extrai o ID do chat (pode ser objeto ou string)
    function getChatId(chat) {
        if (!chat.id) {
            console.warn('[Chat] Chat sem ID:', chat);
            return '';
        }
        // Se id for objeto, usar _serialized ou user
        if (typeof chat.id === 'object') {
            const chatId = chat.id._serialized || chat.id.user || '';
            if (!chatId) {
                console.warn('[Chat] Chat com ID objeto sem _serialized/user:', chat.id);
            }
            return chatId;
        }
        return String(chat.id);
    }

    // Extrai a ultima mensagem do chat (tenta varios campos possiveis)
    function getLastMessage(chat) {
        // Tentar diferentes campos que a API pode retornar
        return chat.lastMessage || chat.msgs?.[0] || chat.lastReceivedMessage || chat.last_message || null;
    }

    // Formata a preview da ultima mensagem (igual ao WhatsApp)
    // Retorna objeto {statusHtml, content} para permitir icones Bootstrap
    function formatLastMessagePreview(lastMessage) {
        if (!lastMessage) return { statusHtml: '', content: '' };

        // Se lastMessage for string, retornar diretamente
        if (typeof lastMessage === 'string') return { statusHtml: '', content: lastMessage };

        const body = lastMessage.body || lastMessage.caption || lastMessage.content || '';
        const type = lastMessage.type || 'chat';
        const fromMe = lastMessage.fromMe || false;
        const ack = lastMessage.ack || 0;

        // Icones Bootstrap para status (mensagens enviadas)
        let statusHtml = '';
        if (fromMe) {
            if (ack >= 2) {
                // Recebido/Lido - double check
                statusHtml = '<i class="bi bi-check-all text-primary me-1"></i>';
            } else if (ack === 1) {
                // Enviado - single check
                statusHtml = '<i class="bi bi-check text-muted me-1"></i>';
            } else {
                // Pendente - relogio
                statusHtml = '<i class="bi bi-clock-history text-muted me-1"></i>';
            }
        }

        // Formatar baseado no tipo de mensagem (emojis Apple-style Unicode)
        let content = '';
        switch (type) {
            case 'image':
                content = '📷 ' + (lastMessage.caption || 'Foto');
                break;
            case 'video':
                content = '📹 ' + (lastMessage.caption || 'Vídeo');
                break;
            case 'audio':
            case 'ptt':
                content = '🎤 Mensagem de voz';
                break;
            case 'document':
                content = '📄 ' + (lastMessage.filename || 'Documento');
                break;
            case 'sticker':
                content = '😀 Figurinha';
                break;
            case 'location':
                content = '📍 Localização';
                break;
            case 'vcard':
            case 'contact_card':
                content = '👤 Contato';
                break;
            case 'revoked':
                content = '🚫 Mensagem apagada';
                break;
            default:
                content = body;
        }

        return { statusHtml, content };
    }

    function renderChatList(chats) {
        if (!chats.length) {
            chatList.innerHTML = `<div class="text-center py-5 text-muted">
                <i data-feather="inbox" style="width: 48px; height: 48px;" class="mb-2"></i>
                <p>Nenhuma conversa</p>
            </div>`;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }

        // Ordenar por ultima mensagem (usar t ao inves de timestamp)
        chats.sort((a, b) => (b.t || b.timestamp || 0) - (a.t || a.timestamp || 0));

        // DEBUG: Log todos os IDs de chat recebidos
        console.log('[Chat] Lista de chats recebidos:', chats.length);
        chats.forEach((chat, index) => {
            const rawId = chat.id;
            const extractedId = getChatId(chat);
            if (extractedId.includes('@lid') || !extractedId) {
                // Log detalhado para debug de chats @lid
                const displayName = chat.contact?.verifiedName || chat.name || chat.contact?.formattedName || chat.contact?.pushname || 'sem-nome';
                console.log(`[Chat] #${index} @lid - ID: ${extractedId} | Nome: ${displayName} | t: ${chat.t || 'sem-timestamp'}`);
                // Log estrutura completa para diagnóstico (apenas primeiros 3)
                if (index < 20) {
                    console.log(`[Chat] #${index} @lid - Estrutura:`, {
                        name: chat.name,
                        contact: chat.contact ? {
                            verifiedName: chat.contact.verifiedName,
                            formattedName: chat.contact.formattedName,
                            pushname: chat.contact.pushname,
                            name: chat.contact.name
                        } : 'sem contact'
                    });
                }
            }
        });

        // Coletar IDs para carregar fotos
        const phonesToLoadPics = [];

        chatList.innerHTML = chats.map(chat => {
            const chatId = getChatId(chat);
            // Nome pode estar em diferentes locais dependendo do tipo de chat (@c.us, @g.us, @lid)
            // Prioridade: verifiedName (contas comerciais) > name > formattedName > pushname
            // verifiedName tem prioridade pois é o nome verificado de contas business do WhatsApp
            const name = chat.contact?.verifiedName || chat.name || chat.contact?.name || chat.contact?.formattedName || chat.contact?.pushname || formatPhone(chatId);
            const lastMsgData = formatLastMessagePreview(getLastMessage(chat));
            const unread = chat.unreadCount || 0;

            // Verificar se já temos a foto no cache ou na resposta da API
            // Foto pode estar em profilePicUrl ou contact.profilePicThumbObj
            let avatarSrc = DEFAULT_AVATAR;
            const profilePic = chat.profilePicUrl ||
                               chat.contact?.profilePicThumbObj?.img ||
                               chat.contact?.profilePicThumbObj?.eurl;
            if (profilePic) {
                avatarSrc = profilePic;
                profilePicCache.set(chatId, profilePic);
            } else if (profilePicCache.has(chatId)) {
                avatarSrc = profilePicCache.get(chatId);
            } else {
                // Adicionar à lista para carregar depois
                phonesToLoadPics.push(chatId);
            }

            return `
                <div class="chat-item p-3 border-bottom ${currentPhone === chatId ? 'active' : ''}"
                     data-phone="${chatId}" data-name="${escapeHtml(name)}" data-unread-count="${unread}">
                    <div class="d-flex align-items-start">
                        <img src="${avatarSrc}"
                             class="rounded-circle chat-avatar me-3"
                             data-avatar-phone="${chatId}"
                             onerror="this.src='${DEFAULT_AVATAR}'"
                             alt="${escapeHtml(name)}">
                        <div class="flex-grow-1 min-width-0">
                            <h6 class="mb-0 text-truncate">${escapeHtml(name)}</h6>
                            <p class="mb-0 text-muted small chat-preview">
                                ${lastMsgData.statusHtml}<span class="chat-preview-text">${escapeHtml(lastMsgData.content)}</span>
                            </p>
                        </div>
                        <div class="d-flex flex-column align-items-end ms-2 flex-shrink-0">
                            <small class="${unread > 0 ? 'text-success fw-bold' : 'text-muted'}">${formatTime(chat.t || chat.timestamp)}</small>
                            ${unread > 0 ? `<span class="badge bg-success rounded-pill mt-1">${unread}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Adicionar eventos de clique
        chatList.querySelectorAll('.chat-item').forEach(item => {
            item.addEventListener('click', () => {
                selectChat(item.dataset.phone, item.dataset.name);
                // Mobile: esconder sidebar ao selecionar chat
                chatSidebar?.classList.add('hidden');
            });
        });

        // Atualizar icones
        if (typeof feather !== 'undefined') {
            feather.replace();
        }

        // Aplicar Twemoji nos previews
        applyTwemoji(chatList);

        // Carregar fotos de perfil em background (primeiras 20 visíveis)
        if (phonesToLoadPics.length > 0) {
            loadProfilePicturesInBackground(phonesToLoadPics.slice(0, 20));
        }

        // Atualizar badge de não lidas e aplicar filtro atual
        updateUnreadFilterBadge();
        filterChats();
    }

    // Seleciona uma conversa
    async function selectChat(phone, name) {
        // Cancelar qualquer marcação pendente do chat anterior
        cancelScheduledMarkAsRead();

        currentPhone = phone;
        currentChat = { phone, name };

        // Resetar flags para novo chat
        isFirstLoad = true;
        lastMessagesHash = null;

        // UI: Mostrar chat ativo
        noChatSelected?.classList.add('d-none');
        activeChat?.classList.remove('d-none');
        activeChat?.classList.add('d-flex');

        // Atualizar header
        chatName.textContent = name || formatPhone(phone);
        chatAvatar.src = DEFAULT_AVATAR;

        // Marcar item como ativo na lista (SEM remover badge ainda)
        chatList.querySelectorAll('.chat-item').forEach(item => {
            item.classList.toggle('active', item.dataset.phone === phone);
        });

        // Carregar foto de perfil
        loadProfilePicture(phone);

        // Carregar mensagens
        await loadMessages(phone);

        // Verificar se há mensagens não lidas (badge) antes de marcar como lida
        const activeItem = chatList.querySelector(`.chat-item[data-phone="${phone}"]`);
        const badge = activeItem?.querySelector('.badge');

        // Só marcar como lida se tiver badge (evita requisições desnecessárias)
        if (badge) {
            markChatAsRead(phone);
            badge.remove();

            // Atualizar data-unread-count para 0 e atualizar badge do filtro
            if (activeItem) {
                activeItem.dataset.unreadCount = '0';
            }
            updateUnreadFilterBadge();
            filterChats();  // Reaplicar filtro para remover da lista "Não lidas" se ativo

            // Restaurar estilo normal do timestamp (remover destaque)
            const rightColumn = activeItem?.querySelector('.d-flex.flex-column.align-items-end');
            const timeEl = rightColumn?.querySelector('small');
            if (timeEl) {
                timeEl.classList.remove('text-success', 'fw-bold');
                timeEl.classList.add('text-muted');
            }
        }

        // Limpar reply pendente
        cancelReply();

        // Focar no input
        messageInput?.focus();
    }

    // Fecha a conversa atual (volta para tela inicial)
    function closeChat() {
        // Cancelar qualquer marcação pendente (mensagem não será marcada como lida)
        cancelScheduledMarkAsRead();

        currentPhone = null;
        currentChat = null;

        // UI: Esconder chat ativo e mostrar mensagem inicial
        activeChat?.classList.add('d-none');
        activeChat?.classList.remove('d-flex');
        noChatSelected?.classList.remove('d-none');

        // Remover classe 'active' de todos os items da lista
        chatList.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });

        // Limpar reply pendente
        cancelReply();

        // Mobile: mostrar sidebar
        chatSidebar?.classList.remove('hidden');
    }

    async function loadProfilePicture(phone) {
        try {
            // Verificar cache primeiro
            if (profilePicCache.has(phone)) {
                const cachedUrl = profilePicCache.get(phone);
                if (cachedUrl) {
                    chatAvatar.src = cachedUrl;
                    return;
                }
            }

            const response = await fetch(`/api/chat/profile-pic/${encodeURIComponent(phone)}/`);
            const data = await response.json();
            const picUrl = data.profilePicUrl || data.eurl;

            if (picUrl) {
                chatAvatar.src = picUrl;
                profilePicCache.set(phone, picUrl);
            } else {
                // Marcar como sem foto para não tentar novamente
                profilePicCache.set(phone, '');
            }
        } catch (error) {
            console.log('Foto de perfil nao disponivel');
        }
    }

    // Marca conversa como lida no servidor (sincroniza com WhatsApp celular)
    async function markChatAsRead(phone) {
        if (!phone) return;

        try {
            console.log('[Chat] Marcando conversa como lida:', phone);
            const response = await fetch('/api/chat/mark-as-read/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ phone })
            });

            if (response.ok) {
                console.log('[Chat] ✓ Conversa marcada como lida:', phone);
            } else {
                const data = await response.json();
                console.warn('[Chat] Falha ao marcar como lida:', data.error || response.status);
            }
        } catch (error) {
            console.warn('[Chat] Erro ao marcar como lida:', error.message);
        }
    }

    // Agenda marcação como lida com debounce (2s após última mensagem)
    function scheduleMarkAsRead(phone) {
        // Cancelar timeout anterior (debounce - cada nova mensagem reseta o timer)
        if (markAsReadTimeout) {
            clearTimeout(markAsReadTimeout);
        }

        // Agendar marcação após 2 segundos de "silêncio"
        // Se novas mensagens chegarem, o timer é resetado
        markAsReadTimeout = setTimeout(() => {
            // Verificar se ainda está no mesmo chat
            if (currentPhone === phone) {
                console.log('[Chat] Debounce: 2s sem novas mensagens, marcando como lida');
                markChatAsRead(phone);
            }
            markAsReadTimeout = null;
        }, MARK_AS_READ_DELAY);
    }

    // Cancela qualquer marcação pendente
    function cancelScheduledMarkAsRead() {
        if (markAsReadTimeout) {
            clearTimeout(markAsReadTimeout);
            markAsReadTimeout = null;
        }
    }

    // Carrega fotos de perfil em background com delay para não sobrecarregar
    async function loadProfilePicturesInBackground(phones) {
        for (let i = 0; i < phones.length; i++) {
            const phone = phones[i];

            // Pular se já está no cache
            if (profilePicCache.has(phone)) continue;

            try {
                const response = await fetch(`/api/chat/profile-pic/${encodeURIComponent(phone)}/`);
                const data = await response.json();
                const picUrl = data.profilePicUrl || data.eurl;

                if (picUrl) {
                    profilePicCache.set(phone, picUrl);
                    // Atualizar imagem no DOM
                    const imgEl = chatList.querySelector(`img[data-avatar-phone="${phone}"]`);
                    if (imgEl) {
                        imgEl.src = picUrl;
                    }
                } else {
                    // Marcar como sem foto
                    profilePicCache.set(phone, '');
                }
            } catch (error) {
                // Erro silencioso - manter avatar padrão
            }

            // Pequeno delay entre requisições para não sobrecarregar
            if (i < phones.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    async function loadMessages(phone, silent = false) {
        // Só mostrar spinner no primeiro carregamento (não no polling)
        if (!silent && isFirstLoad) {
            messagesContainer.innerHTML = `<div class="chat-loading">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Carregando...</span>
                </div>
            </div>`;
        }

        try {
            console.log('[Chat] Carregando mensagens do chat:', phone, silent ? '(silent)' : '');
            const response = await fetch(`/api/chat/messages/${encodeURIComponent(phone)}/`);
            const data = await response.json();

            if (response.ok && Array.isArray(data)) {
                // Criar hash simples para comparar se houve mudanças
                const newHash = data.length + '-' + (data[data.length - 1]?.id || '');

                // Só renderizar se houver mudanças ou for primeiro carregamento
                if (!silent || newHash !== lastMessagesHash) {
                    console.log('[Chat] Renderizando', data.length, 'mensagens');
                    const wasAtBottom = isScrolledToBottom();
                    renderMessages(data);
                    lastMessagesHash = newHash;

                    // Só rolar para baixo se já estava no final ou é primeiro carregamento
                    if (wasAtBottom || isFirstLoad) {
                        scrollToBottom();
                    }
                }
                isFirstLoad = false;
            } else if (!silent) {
                console.log('[Chat] Messages erro - data.error:', data.error);
                messagesContainer.innerHTML = `<div class="text-center text-danger py-5">
                    ${data.error || 'Erro ao carregar mensagens'}
                </div>`;
            }
        } catch (error) {
            console.error('[Chat] Erro ao carregar mensagens:', error);
            if (!silent) {
                messagesContainer.innerHTML = `<div class="text-center text-danger py-5">
                    Erro ao carregar mensagens
                </div>`;
            }
        }
    }

    // Verifica se o scroll está no final
    function isScrolledToBottom() {
        if (!messagesContainer) return true;
        const threshold = 100; // tolerância de 100px
        return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold;
    }

    function renderMessages(messages) {
        if (!messages.length) {
            messagesContainer.innerHTML = `<div class="text-center text-muted py-5">
                <i data-feather="message-square" style="width: 48px; height: 48px;" class="mb-2"></i>
                <p>Nenhuma mensagem</p>
            </div>`;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }

        // Ordenar por timestamp
        messages.sort((a, b) => a.timestamp - b.timestamp);

        let lastDate = null;
        let html = '';

        messages.forEach(msg => {
            const msgDate = formatDate(msg.timestamp);

            // Separador de data
            if (msgDate !== lastDate) {
                html += `<div class="text-center my-3">
                    <span class="badge bg-light text-muted px-3 py-2">${msgDate}</span>
                </div>`;
                lastDate = msgDate;
            }

            const isSent = msg.fromMe;
            const time = formatTimeShort(msg.timestamp);

            html += `
                <div class="d-flex ${isSent ? 'justify-content-end' : 'justify-content-start'} mb-2">
                    <div class="message-bubble ${isSent ? 'msg-sent' : 'msg-received'} p-2 px-3 shadow-sm"
                         data-message-id="${msg.id}">
                        ${msg.quotedMsg ? renderQuotedMessage(msg.quotedMsg) : ''}
                        ${renderMessageContent(msg)}
                        <div class="d-flex justify-content-end align-items-center mt-1">
                            <small class="text-muted msg-status">${time}</small>
                            ${isSent ? renderMessageStatus(msg.ack) : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        messagesContainer.innerHTML = html;

        // Adicionar eventos de clique para reply
        messagesContainer.querySelectorAll('.message-bubble').forEach(bubble => {
            bubble.addEventListener('dblclick', () => {
                const msgId = bubble.dataset.messageId;
                const msgText = bubble.querySelector('.msg-body')?.textContent || '';
                setReplyTo(msgId, msgText);
            });
        });

        // Adicionar eventos para visualizar imagens
        messagesContainer.querySelectorAll('.msg-image').forEach(img => {
            img.addEventListener('click', () => {
                const modal = document.getElementById('imageViewerModal');
                const modalImg = document.getElementById('image-viewer-img');
                if (modal && modalImg) {
                    modalImg.src = img.src;
                    new bootstrap.Modal(modal).show();
                }
            });
        });

        scrollToBottom();

        // Atualizar icones
        if (typeof feather !== 'undefined') {
            feather.replace();
        }

        // Aplicar Twemoji nas mensagens
        applyTwemoji(messagesContainer);
    }

    function renderQuotedMessage(quoted) {
        if (!quoted) return '';
        return `<div class="bg-light rounded p-2 mb-2 border-start border-3 border-success small">
            <p class="mb-0 text-truncate">${escapeHtml(quoted.body || 'Mensagem')}</p>
        </div>`;
    }

    function renderMessageContent(msg) {
        const type = msg.type || 'chat';
        // Extrair messageId corretamente (pode ser objeto ou string)
        const messageId = typeof msg.id === 'object' ? (msg.id._serialized || msg.id.id) : msg.id;

        if (type === 'image' || msg.mimetype?.startsWith('image/')) {
            // Para imagens, usar o endpoint de download ou preview base64
            // msg.body contém a legenda, NÃO a imagem
            // msg.mediaData?.preview pode ter preview base64
            // NOTA: NÃO usar deprecatedMms3Url - URLs expiram rapidamente e retornam 403
            let imgSrc = '';
            if (msg.mediaData?.preview) {
                // Preview base64 disponível
                imgSrc = `data:${msg.mimetype || 'image/jpeg'};base64,${msg.mediaData.preview}`;
            } else if (messageId) {
                // Usar API de download (sempre funciona)
                imgSrc = `/api/chat/download/${encodeURIComponent(messageId)}/`;
            }

            // A legenda pode estar em msg.body ou msg.caption
            const caption = msg.caption || (type === 'image' ? msg.body : '') || '';

            return `<div class="mb-1">
                ${imgSrc ? `<img src="${imgSrc}" class="img-fluid rounded msg-image" style="max-height: 300px; cursor: pointer;"
                     onerror="this.parentElement.innerHTML='<div class=\\'text-muted small\\'><i data-feather=\\'image\\'></i> Imagem não disponível</div>'">` : '<div class="text-muted small"><i data-feather="image"></i> Imagem</div>'}
                ${caption ? `<p class="mb-0 mt-1 msg-body">${escapeHtml(caption)}</p>` : ''}
            </div>`;
        }

        if (type === 'document' || type === 'application') {
            return `<div class="d-flex align-items-center">
                <i data-feather="file" class="me-2"></i>
                <a href="/api/chat/download/${encodeURIComponent(messageId)}/" class="text-decoration-none" target="_blank">
                    ${escapeHtml(msg.filename || 'Documento')}
                </a>
            </div>`;
        }

        if (type === 'audio' || type === 'ptt') {
            // Áudios precisam ser baixados via API
            const audioSrc = messageId ? `/api/chat/download/${encodeURIComponent(messageId)}/` : '';
            return `<div class="audio-message">
                ${audioSrc ? `<audio controls class="w-100" style="max-width: 250px;">
                    <source src="${audioSrc}" type="${msg.mimetype || 'audio/ogg'}">
                    Seu navegador não suporta áudio.
                </audio>` : '<span class="text-muted small"><i data-feather="mic"></i> Áudio</span>'}
            </div>`;
        }

        if (type === 'video') {
            const videoSrc = messageId ? `/api/chat/download/${encodeURIComponent(messageId)}/` : '';
            return `<div class="video-message">
                ${videoSrc ? `<video controls class="img-fluid rounded" style="max-height: 300px;">
                    <source src="${videoSrc}" type="${msg.mimetype || 'video/mp4'}">
                    Seu navegador não suporta vídeo.
                </video>` : '<span class="text-muted small"><i data-feather="video"></i> Vídeo</span>'}
                ${msg.caption ? `<p class="mb-0 mt-1 msg-body">${escapeHtml(msg.caption)}</p>` : ''}
            </div>`;
        }

        if (type === 'sticker') {
            let stickerSrc = '';
            if (msg.mediaData?.preview) {
                stickerSrc = `data:${msg.mimetype || 'image/webp'};base64,${msg.mediaData.preview}`;
            } else if (messageId) {
                stickerSrc = `/api/chat/download/${encodeURIComponent(messageId)}/`;
            }
            return `${stickerSrc ? `<img src="${stickerSrc}" class="img-fluid" style="max-width: 150px;"
                         onerror="this.style.display='none'">` : '<span class="text-muted">😀 Figurinha</span>'}`;
        }

        if (type === 'location') {
            const lat = msg.lat || 0;
            const lng = msg.lng || 0;
            return `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" class="text-decoration-none">
                <i data-feather="map-pin" class="me-1"></i> Ver localizacao
            </a>`;
        }

        // Mensagem de texto padrao
        return `<p class="mb-0 msg-body">${formatMessageText(msg.body || '')}</p>`;
    }

    function formatMessageText(text) {
        // Escapar HTML
        text = escapeHtml(text);

        // Converter URLs em links
        text = text.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener">$1</a>'
        );

        // Converter quebras de linha
        text = text.replace(/\n/g, '<br>');

        // Formatacao WhatsApp basica
        text = text.replace(/\*([^*]+)\*/g, '<strong>$1</strong>'); // *negrito*
        text = text.replace(/_([^_]+)_/g, '<em>$1</em>'); // _italico_
        text = text.replace(/~([^~]+)~/g, '<del>$1</del>'); // ~riscado~

        return text;
    }

    function renderMessageStatus(ack) {
        // 0: pending, 1: sent, 2: received, 3: read
        if (ack === undefined || ack === null) return '';

        const statuses = {
            0: { icon: 'clock', class: 'text-muted' },
            1: { icon: 'check', class: 'text-muted' },
            2: { icon: 'check-check', class: 'text-muted' },
            3: { icon: 'check-check', class: 'read' }
        };

        const status = statuses[ack] || statuses[0];

        if (ack >= 2) {
            return `<span class="ms-1 ${status.class}"><i data-feather="check" style="width: 12px; height: 12px;"></i><i data-feather="check" style="width: 12px; height: 12px; margin-left: -8px;"></i></span>`;
        }

        return `<span class="ms-1 ${status.class}"><i data-feather="check" style="width: 12px; height: 12px;"></i></span>`;
    }

    // Enviar mensagem
    async function handleSendMessage(e) {
        e.preventDefault();

        const message = messageInput.value.trim();
        if (!message || !currentPhone) return;

        const replyTo = replyToMessageId;

        // Limpar input
        messageInput.value = '';
        autoResizeTextarea();
        cancelReply();

        // Adicionar mensagem otimista
        appendOptimisticMessage(message);

        try {
            const response = await fetch('/api/chat/send-message/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({
                    phone: currentPhone,
                    message: message,
                    replyTo: replyTo
                })
            });

            if (!response.ok) {
                const data = await response.json();
                showToast(data.error || 'Erro ao enviar mensagem', 'danger');
            }
        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);
            showToast('Erro de conexao', 'danger');
        }
    }

    function appendOptimisticMessage(text) {
        const now = new Date();
        const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const html = `
            <div class="d-flex justify-content-end mb-2 optimistic-msg">
                <div class="message-bubble msg-sent p-2 px-3 shadow-sm">
                    <p class="mb-0 msg-body">${formatMessageText(text)}</p>
                    <div class="d-flex justify-content-end align-items-center mt-1">
                        <small class="text-muted msg-status">${time}</small>
                        <span class="ms-1 text-muted"><i data-feather="clock" style="width: 12px; height: 12px;"></i></span>
                    </div>
                </div>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', html);
        scrollToBottom();

        if (typeof feather !== 'undefined') {
            feather.replace();
        }

        // Aplicar Twemoji na mensagem otimista
        applyTwemoji(messagesContainer.lastElementChild);
    }

    // Upload de arquivo
    async function handleFileUpload() {
        const file = fileInput.files[0];
        if (!file || !currentPhone) return;

        const fileType = fileInput.dataset.type || 'file';

        // Mostrar indicador de upload
        showToast('Enviando arquivo...', 'info');

        const formData = new FormData();
        formData.append('phone', currentPhone);
        formData.append('file', file);
        formData.append('type', fileType);

        try {
            const response = await fetch('/api/chat/send-file/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });

            if (response.ok) {
                showToast('Arquivo enviado!', 'success');
                // Recarregar mensagens
                loadMessages(currentPhone);
            } else {
                const data = await response.json();
                showToast(data.error || 'Erro ao enviar arquivo', 'danger');
            }
        } catch (error) {
            console.error('Erro ao enviar arquivo:', error);
            showToast('Erro de conexao', 'danger');
        }

        fileInput.value = '';
    }

    // Reply
    function setReplyTo(messageId, messageText) {
        replyToMessageId = messageId;
        replyText.textContent = truncateText(messageText, 50);
        replyPreview?.classList.remove('d-none');
        messageInput?.focus();
    }

    function cancelReply() {
        replyToMessageId = null;
        replyPreview?.classList.add('d-none');
    }

    // === SSE (Server-Sent Events) ===
    function connectSSE() {
        // Fechar conexao existente
        if (eventSource) {
            eventSource.close();
        }

        // Limpar timeout de reconexao
        if (sseReconnectTimeout) {
            clearTimeout(sseReconnectTimeout);
            sseReconnectTimeout = null;
        }

        console.log('[SSE] Conectando... (tentativa', sseReconnectAttempts + 1, ') | sessão:', currentSession || 'não definida');
        eventSource = new EventSource('/api/chat/sse/');

        eventSource.onopen = () => {
            console.log('[SSE] ✓ Conectado! Atualizações virão via webhook.');
            sseConnected = true;

            // Se estava desconectado antes (reconexão), atualizar dados
            if (sseReconnectAttempts > 0) {
                console.log('[SSE] Reconexão bem-sucedida - atualizando dados...');
                loadChatListSilent();
                if (currentPhone) {
                    loadMessages(currentPhone, true);
                }
            }

            sseReconnectAttempts = 0;  // Reset contador de falhas

            // Desativar polling de fallback se estava ativo
            if (fallbackPollingActive) {
                console.log('[SSE] Desativando polling de fallback');
                fallbackPollingActive = false;
                if (pollingInterval) {
                    clearInterval(pollingInterval);
                    pollingInterval = null;
                }
            }
        };

        eventSource.onmessage = (e) => {
            // Ignorar heartbeats (linhas vazias ou comentários)
            if (!e.data || e.data.trim() === '' || e.data.startsWith(':')) {
                return;
            }

            try {
                const event = JSON.parse(e.data);
                console.log('[SSE] ← Evento:', event.type);
                handleSSEEvent(event);
            } catch (err) {
                console.error('[SSE] Erro ao parsear:', err.message, '| Data:', e.data.substring(0, 200));
            }
        };

        eventSource.onerror = (e) => {
            sseConnected = false;
            sseReconnectAttempts++;
            eventSource.close();

            console.warn('[SSE] ✗ Erro na conexão (falha #' + sseReconnectAttempts + ')');

            // Calcular delay exponencial: 1s, 2s, 4s, 8s, 16s, 30s (max)
            const delay = Math.min(
                SSE_RECONNECT_DELAY_BASE * Math.pow(2, sseReconnectAttempts - 1),
                SSE_RECONNECT_DELAY_MAX
            );

            // Se muitas falhas, ativar polling de fallback
            if (sseReconnectAttempts >= SSE_MAX_FAILURES && !fallbackPollingActive) {
                console.warn('[SSE] Muitas falhas - ativando polling de fallback (30s)');
                fallbackPollingActive = true;
                startFallbackPolling();
            }

            // Reconectar apos delay (se pagina visivel)
            if (document.visibilityState === 'visible') {
                console.log(`[SSE] Reconectando em ${delay}ms...`);
                sseReconnectTimeout = setTimeout(connectSSE, delay);
            }
        };
    }

    // Polling de fallback quando SSE falha repetidamente
    function startFallbackPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }

        console.log('[Polling] Iniciando polling de fallback (30s)');
        pollingInterval = setInterval(() => {
            if (document.visibilityState === 'visible' && fallbackPollingActive) {
                console.log('[Polling] Verificando atualizações...');
                loadChatListSilent();
                if (currentPhone) {
                    loadMessages(currentPhone, true);
                }
            }
        }, 30000);  // 30 segundos
    }

    // Polling específico para desenvolvimento (localhost)
    // Complementa o SSE que não funciona bem com Django runserver
    function startDevPolling() {
        if (devPollingInterval) {
            clearInterval(devPollingInterval);
        }

        devPollingInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                console.log('[Dev Polling] Verificando atualizações...');
                loadChatListSilent();
                if (currentPhone) {
                    loadMessages(currentPhone, true);  // silent=true
                }
            }
        }, DEV_POLLING_INTERVAL);
    }

    function stopDevPolling() {
        if (devPollingInterval) {
            clearInterval(devPollingInterval);
            devPollingInterval = null;
            console.log('[Dev Polling] Parado');
        }
    }

    function disconnectSSE() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        if (sseReconnectTimeout) {
            clearTimeout(sseReconnectTimeout);
            sseReconnectTimeout = null;
        }
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        sseConnected = false;
        fallbackPollingActive = false;
        console.log('[SSE] Desconectado');
    }

    function handleSSEEvent(event) {
        // TODO: Reativar filtro quando resolver incompatibilidade de sessão
        // O webhook envia session="teste" mas a sessão cadastrada é "jrg"
        // Por enquanto, processar TODOS os eventos SSE
        const eventSession = event.data?.session || event.session;
        console.log('[SSE] Processando evento:', event.type, '| session do evento:', eventSession, '| session esperada:', currentSession);

        switch (event.type) {
            case 'connected':
                console.log('[SSE] ✓ Conexão confirmada - userId:', event.userId || event.data?.userId);
                break;

            case 'new_message':
                console.log('[SSE] 📩 Nova mensagem:', event.data?.chatId);
                if (event.data) {
                    handleNewMessage(event.data);
                } else {
                    console.error('[SSE] Evento new_message sem data:', event);
                }
                break;

            case 'message_ack':
                console.log('[SSE] ✓✓ ACK recebido:', event.data?.messageId, 'ack:', event.data?.ack);
                if (event.data) {
                    handleMessageAck(event.data);
                }
                break;

            case 'message_sent':
                console.log('[SSE] ✓ Mensagem enviada:', event.data?.chatId);
                if (event.data) {
                    handleMessageSent(event.data);
                }
                break;

            case 'chat_update':
                console.log('[SSE] 🔄 Atualização de chat');
                loadChatListSilent();
                break;

            default:
                console.log('[SSE] Evento desconhecido:', event.type, event);
        }
    }

    function handleNewMessage(data) {
        const chatId = data.chatId;
        const senderName = data.senderName || '';
        const message = data.message;

        console.log('[SSE] Nova mensagem de:', chatId, '- Nome:', senderName);

        // Verificar se é o chat atual
        const isCurrentChat = currentPhone && chatId && chatId.includes(formatPhone(currentPhone));

        // Se é o chat atual, adicionar mensagem instantaneamente
        if (isCurrentChat) {
            appendNewMessage(message);
            // Agendar marcação como lida com debounce de 2s
            // Cada nova mensagem reseta o timer (aguarda todas chegarem)
            scheduleMarkAsRead(currentPhone);
        }

        // Atualizar preview do chat na lista (ou criar se não existir)
        updateChatPreview(chatId, message, senderName);

        // Mostrar notificação se não for o chat atual ou aba não visível
        if (!isCurrentChat || document.visibilityState !== 'visible') {
            showNotification(message);
        }
    }

    // Atualiza o preview de um chat especifico na lista (ou cria se não existir)
    function updateChatPreview(chatId, message, senderName = '') {
        // Encontrar o item do chat na lista
        let chatItem = chatList.querySelector(`.chat-item[data-phone="${chatId}"]`);

        if (chatItem) {
            // Chat existe - atualizar preview
            const previewEl = chatItem.querySelector('.chat-preview-text');
            const previewContainer = chatItem.querySelector('.chat-preview');

            if (previewEl) {
                const lastMsgData = formatLastMessagePreview(message);
                previewEl.textContent = lastMsgData.content;

                // Atualizar icone de status se existir
                const existingIcon = previewContainer?.querySelector('i');
                if (existingIcon && lastMsgData.statusHtml) {
                    existingIcon.outerHTML = lastMsgData.statusHtml;
                } else if (!existingIcon && lastMsgData.statusHtml) {
                    previewContainer?.insertAdjacentHTML('afterbegin', lastMsgData.statusHtml);
                }
            }

            // Atualizar timestamp (dentro do container de coluna à direita)
            const rightColumn = chatItem.querySelector('.d-flex.flex-column.align-items-end');
            const timeEl = rightColumn?.querySelector('small');
            if (timeEl) {
                timeEl.textContent = formatTime(message.t || message.timestamp || Date.now() / 1000);
            }

            // Mover chat para o topo da lista (mais recente)
            if (chatItem.parentElement.firstChild !== chatItem) {
                chatItem.parentElement.insertBefore(chatItem, chatItem.parentElement.firstChild);
            }

            // Incrementar badge se não for o chat atual
            if (!currentPhone || !chatId.includes(formatPhone(currentPhone))) {
                const badge = chatItem.querySelector('.badge');
                const currentUnread = parseInt(chatItem.dataset.unreadCount || '0', 10);
                const newUnread = currentUnread + 1;

                // Atualizar data-unread-count
                chatItem.dataset.unreadCount = newUnread;

                if (badge) {
                    badge.textContent = newUnread;
                } else if (rightColumn) {
                    // Adicionar badge na coluna da direita (abaixo do timestamp)
                    rightColumn.insertAdjacentHTML('beforeend',
                        `<span class="badge bg-success rounded-pill mt-1">1</span>`);
                }
                // Atualizar estilo do timestamp para destacar (mesma cor do badge)
                if (timeEl) {
                    timeEl.classList.remove('text-muted');
                    timeEl.classList.add('text-success', 'fw-bold');
                }

                // Atualizar badge do filtro e reaplicar filtro
                updateUnreadFilterBadge();
                filterChats();  // Mostrar na lista "Não lidas" se filtro ativo
            }

            // Aplicar Twemoji no preview atualizado
            applyTwemoji(chatItem);

            console.log('[SSE] Preview atualizado para:', chatId);
        } else {
            // Chat não existe na lista - criar novo item no topo
            console.log('[SSE] Criando novo chat na lista:', chatId, senderName);

            const name = senderName || message.notifyName || message.pushname || formatPhone(chatId);
            const lastMsgData = formatLastMessagePreview(message);
            const timestamp = message.t || message.timestamp || Date.now() / 1000;

            const newChatHtml = `
                <div class="chat-item p-3 border-bottom" data-phone="${chatId}" data-name="${escapeHtml(name)}" data-unread-count="1">
                    <div class="d-flex align-items-start">
                        <img src="${DEFAULT_AVATAR}"
                             class="rounded-circle chat-avatar me-3"
                             data-avatar-phone="${chatId}"
                             onerror="this.src='${DEFAULT_AVATAR}'"
                             alt="${escapeHtml(name)}">
                        <div class="flex-grow-1 min-width-0">
                            <h6 class="mb-0 text-truncate">${escapeHtml(name)}</h6>
                            <p class="mb-0 text-muted small chat-preview">
                                ${lastMsgData.statusHtml}<span class="chat-preview-text">${escapeHtml(lastMsgData.content)}</span>
                            </p>
                        </div>
                        <div class="d-flex flex-column align-items-end ms-2 flex-shrink-0">
                            <small class="text-success fw-bold">${formatTime(timestamp)}</small>
                            <span class="badge bg-success rounded-pill mt-1">1</span>
                        </div>
                    </div>
                </div>
            `;

            // Inserir no topo da lista
            chatList.insertAdjacentHTML('afterbegin', newChatHtml);

            // Adicionar evento de clique no novo item
            const newItem = chatList.firstElementChild;
            newItem.addEventListener('click', () => {
                selectChat(newItem.dataset.phone, newItem.dataset.name);
                chatSidebar?.classList.add('hidden');
            });

            // Aplicar Twemoji e Feather
            applyTwemoji(newItem);
            if (typeof feather !== 'undefined') feather.replace();

            // Carregar foto de perfil em background
            loadProfilePicturesInBackground([chatId]);

            // Atualizar badge do filtro e reaplicar filtro
            updateUnreadFilterBadge();
            filterChats();  // Mostrar na lista "Não lidas" se filtro ativo

            console.log('[SSE] Novo chat adicionado à lista:', chatId);
        }
    }

    function handleMessageAck(data) {
        const chatId = data.chatId;
        const messageId = data.messageId;
        const ack = data.ack;

        console.log('[SSE] ACK recebido - chat:', chatId, 'msg:', messageId, 'ack:', ack);

        // Atualizar status da mensagem no DOM (se o chat atual)
        const msgBubble = messagesContainer?.querySelector(`[data-message-id="${messageId}"]`);
        if (msgBubble) {
            const statusEl = msgBubble.querySelector('.msg-status')?.parentElement;
            if (statusEl) {
                // Remover icone antigo e adicionar novo
                const checkIcons = statusEl.querySelectorAll('[data-feather="check"], [data-feather="clock"]');
                checkIcons.forEach(icon => icon.parentElement?.remove());

                // Adicionar novo status
                const newStatus = renderMessageStatus(ack);
                if (newStatus) {
                    statusEl.insertAdjacentHTML('beforeend', newStatus);
                    if (typeof feather !== 'undefined') feather.replace();
                }
            }
        }

        // Atualizar ícone de status no preview da lista de chats
        if (chatId) {
            const chatItem = chatList.querySelector(`.chat-item[data-phone="${chatId}"]`);
            if (chatItem) {
                const previewContainer = chatItem.querySelector('.chat-preview');
                const existingIcon = previewContainer?.querySelector('i.bi');
                if (existingIcon) {
                    // Atualizar ícone baseado no ack
                    if (ack >= 2) {
                        existingIcon.className = 'bi bi-check-all text-primary me-1';
                    } else if (ack === 1) {
                        existingIcon.className = 'bi bi-check text-muted me-1';
                    }
                }
            }
        }
    }

    function handleMessageSent(data) {
        const chatId = data.chatId;
        const message = data.message;

        console.log('[SSE] Mensagem enviada confirmada para:', chatId);

        // Remover mensagem otimista e adicionar a real
        const optimisticMsgs = messagesContainer?.querySelectorAll('.optimistic-msg');
        if (optimisticMsgs?.length > 0) {
            optimisticMsgs[0].remove();
        }

        // Se e o chat atual, adicionar mensagem confirmada
        if (currentPhone && chatId && chatId.includes(formatPhone(currentPhone))) {
            appendNewMessage(message);
        }
    }

    function appendNewMessage(msg) {
        if (!messagesContainer) return;

        // Verificar se mensagem ja existe
        const msgId = typeof msg.id === 'object' ? (msg.id._serialized || msg.id.id) : msg.id;
        if (messagesContainer.querySelector(`[data-message-id="${msgId}"]`)) {
            return; // Mensagem ja renderizada
        }

        const isSent = msg.fromMe;
        const time = formatTimeShort(msg.timestamp);

        const html = `
            <div class="d-flex ${isSent ? 'justify-content-end' : 'justify-content-start'} mb-2">
                <div class="message-bubble ${isSent ? 'msg-sent' : 'msg-received'} p-2 px-3 shadow-sm"
                     data-message-id="${msgId}">
                    ${msg.quotedMsg ? renderQuotedMessage(msg.quotedMsg) : ''}
                    ${renderMessageContent(msg)}
                    <div class="d-flex justify-content-end align-items-center mt-1">
                        <small class="text-muted msg-status">${time}</small>
                        ${isSent ? renderMessageStatus(msg.ack) : ''}
                    </div>
                </div>
            </div>
        `;

        // Verificar se estava no final antes de adicionar
        const wasAtBottom = isScrolledToBottom();

        messagesContainer.insertAdjacentHTML('beforeend', html);

        // Adicionar evento de reply na nova mensagem
        const newBubble = messagesContainer.lastElementChild?.querySelector('.message-bubble');
        if (newBubble) {
            newBubble.addEventListener('dblclick', () => {
                const msgText = newBubble.querySelector('.msg-body')?.textContent || '';
                setReplyTo(msgId, msgText);
            });
        }

        // Se for imagem, adicionar evento de clique
        const newImg = messagesContainer.lastElementChild?.querySelector('.msg-image');
        if (newImg) {
            newImg.addEventListener('click', () => {
                const modal = document.getElementById('imageViewerModal');
                const modalImg = document.getElementById('image-viewer-img');
                if (modal && modalImg) {
                    modalImg.src = newImg.src;
                    new bootstrap.Modal(modal).show();
                }
            });
        }

        // Scroll para baixo se estava no final
        if (wasAtBottom) {
            scrollToBottom();
        }

        if (typeof feather !== 'undefined') feather.replace();

        // Aplicar Twemoji na nova mensagem
        applyTwemoji(messagesContainer.lastElementChild);
    }

    function showNotification(msg) {
        // Verificar se notificacoes estao permitidas
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            return;
        }

        // Extrair informacoes da mensagem
        const body = msg.body || msg.caption || 'Nova mensagem';
        const from = msg.notifyName || msg.pushname || formatPhone(msg.from || '');

        try {
            const notification = new Notification(from, {
                body: truncateText(body, 100),
                icon: '/static/assets/images/logo/whatsapp-icon.png',
                tag: 'whatsapp-chat',
                renotify: true
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            // Auto-fechar apos 5 segundos
            setTimeout(() => notification.close(), 5000);
        } catch (err) {
            console.log('[Notification] Erro ao mostrar notificacao:', err);
        }
    }

    function setupVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('[Chat] Aba ficou visível - verificando conexão SSE...');

                // Reconectar SSE se desconectado
                if (!sseConnected && !sseReconnectTimeout) {
                    console.log('[Chat] SSE desconectado - reconectando...');
                    sseReconnectAttempts = 0;  // Reset para tentar novamente
                    connectSSE();
                }

                // Se o SSE estava falhando muito, fazer um refresh dos dados
                if (fallbackPollingActive) {
                    console.log('[Chat] Polling ativo - atualizando dados...');
                    loadChatListSilent();
                    if (currentPhone) {
                        loadMessages(currentPhone, true);
                    }
                }
            } else {
                // Manter SSE conectado para receber notificações mesmo com aba oculta
                console.log('[Chat] Aba ficou oculta - mantendo SSE');
            }
        });
    }

    // Carrega lista de conversas silenciosamente (para refresh manual)
    // Usado apenas quando o usuário clica em atualizar ou recarrega a página
    async function loadChatListSilent() {
        try {
            console.log('[Chat] Atualizando lista de chats (manual)...');
            const response = await fetch('/api/chat/list/');
            const data = await response.json();

            if (response.ok && Array.isArray(data)) {
                // Atualizar dados sem recriar HTML completamente (evita "piscar")
                updateChatListData(data);
                console.log('[Chat] Lista atualizada com', data.length, 'chats');
            }
        } catch (error) {
            console.log('[Chat] Erro ao atualizar chats:', error.message);
        }
    }

    // Atualiza apenas os dados dos chats existentes sem recriar todo o HTML
    function updateChatListData(chats) {
        const existingItems = chatList.querySelectorAll('.chat-item');

        // Se nao tem items, renderizar normalmente
        if (existingItems.length === 0) {
            renderChatList(chats);
            return;
        }

        // Criar mapa dos chats recebidos
        const chatMap = new Map();
        chats.forEach(chat => {
            const chatId = getChatId(chat);
            chatMap.set(chatId, chat);
        });

        // Atualizar cada item existente
        existingItems.forEach(item => {
            const phone = item.dataset.phone;
            const chat = chatMap.get(phone);

            if (chat) {
                // Atualizar preview da ultima mensagem
                const previewEl = item.querySelector('.chat-preview-text');
                const statusEl = item.querySelector('.chat-preview > i');
                const lastMsgData = formatLastMessagePreview(getLastMessage(chat));

                if (previewEl && lastMsgData.content) {
                    previewEl.textContent = lastMsgData.content;
                }

                // Atualizar timestamp
                const timeEl = item.querySelector('small.text-muted');
                if (timeEl) {
                    timeEl.textContent = formatTime(chat.t || chat.timestamp);
                }

                // Atualizar badge de nao lidas
                // NOTA: Não remover badges locais - apenas atualizar se a API tiver valor maior
                const badge = item.querySelector('.badge');
                const unread = chat.unreadCount || 0;
                const currentBadgeCount = badge ? parseInt(badge.textContent || '0') : 0;

                if (unread > 0 && unread > currentBadgeCount) {
                    // API tem mais não lidas que o badge local
                    if (badge) {
                        badge.textContent = unread;
                    } else {
                        const flexDiv = item.querySelector('.d-flex.align-items-center');
                        if (flexDiv) {
                            flexDiv.insertAdjacentHTML('beforeend',
                                `<span class="badge bg-success rounded-pill ms-2">${unread}</span>`);
                        }
                    }
                }
                // NÃO remover badge local - será removido quando usuário abrir o chat

                // Remover do mapa (processado)
                chatMap.delete(phone);
            }
        });

        // Se tem chats novos que nao existiam, NÃO recriar a lista
        // (isso causa "piscar" da página - novos chats serão adicionados na próxima navegação)
        if (chatMap.size > 0) {
            console.log('[Chat] %d novos chats detectados (ignorados para evitar piscar)', chatMap.size);
        }
    }

    // Busca/filtro de conversas
    function filterChats() {
        const query = searchInput.value.toLowerCase();
        chatList.querySelectorAll('.chat-item').forEach(item => {
            const name = (item.dataset.name || '').toLowerCase();
            const phone = (item.dataset.phone || '').toLowerCase();
            const unreadCount = parseInt(item.dataset.unreadCount || '0', 10);

            // Primeiro verifica se passa no filtro de busca
            const matchesSearch = name.includes(query) || phone.includes(query);

            // Depois verifica se passa no filtro de não lidas
            const matchesFilter = currentFilter === 'all' || (currentFilter === 'unread' && unreadCount > 0);

            item.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
        });
    }

    /**
     * Conta total de chats não lidos
     */
    function countUnreadChats() {
        let count = 0;
        chatList.querySelectorAll('.chat-item').forEach(item => {
            const unreadCount = parseInt(item.dataset.unreadCount || '0', 10);
            if (unreadCount > 0) count++;
        });
        return count;
    }

    /**
     * Atualiza o badge do filtro "Não lidas"
     */
    function updateUnreadFilterBadge() {
        const badge = document.getElementById('unread-count-badge');
        if (!badge) return;

        const count = countUnreadChats();
        badge.textContent = count;

        if (count > 0) {
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
        }
    }

    /**
     * Aplica o filtro selecionado
     */
    function applyFilter(filter) {
        currentFilter = filter;

        // Atualizar estado visual dos botões
        document.querySelectorAll('.filter-btn').forEach(btn => {
            if (btn.dataset.filter === filter) {
                btn.classList.remove('btn-outline-secondary');
                btn.classList.add('btn-success', 'active');
            } else {
                btn.classList.remove('btn-success', 'active');
                btn.classList.add('btn-outline-secondary');
            }
        });

        // Aplicar filtro na lista
        filterChats();
    }

    // Utilidades
    function scrollToBottom() {
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    function autoResizeTextarea() {
        if (messageInput) {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
        }
    }

    function formatPhone(phone) {
        if (!phone) return '';
        // Se for objeto, extrair _serialized ou user
        if (typeof phone === 'object') {
            phone = phone._serialized || phone.user || '';
        }
        if (typeof phone !== 'string') return '';
        // Remover sufixos do WhatsApp (@c.us, @g.us, @lid)
        return phone.replace(/@(c\.us|g\.us|lid)$/, '');
    }

    function formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        const now = new Date();

        // Criar datas "zeradas" (meia-noite) para comparação de dias
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        // Calcular o último domingo (início da semana)
        const lastSunday = new Date(today);
        lastSunday.setDate(today.getDate() - today.getDay());

        // Hoje: mostrar horário
        if (messageDay.getTime() === today.getTime()) {
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        // Ontem: mostrar "Ontem"
        if (messageDay.getTime() === yesterday.getTime()) {
            return 'Ontem';
        }

        // Esta semana (do último domingo até dois dias atrás): mostrar dia da semana
        if (messageDay >= lastSunday && messageDay < yesterday) {
            return date.toLocaleDateString('pt-BR', { weekday: 'short' });
        }

        // Antes do último domingo: mostrar data
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }

    function formatTimeShort(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function formatDate(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        const now = new Date();

        if (date.toDateString() === now.toDateString()) {
            return 'Hoje';
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Ontem';
        }

        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    function truncateText(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getCsrfToken() {
        return document.querySelector('[name=csrfmiddlewaretoken]')?.value ||
               document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
    }

    function showToast(message, type = 'info') {
        // Criar toast simples
        const toastHtml = `
            <div class="toast align-items-center text-white bg-${type} border-0 position-fixed bottom-0 end-0 m-3"
                 role="alert" style="z-index: 9999;">
                <div class="d-flex">
                    <div class="toast-body">${escapeHtml(message)}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto"
                            data-bs-dismiss="toast"></button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', toastHtml);
        const toastEl = document.body.lastElementChild;

        if (typeof bootstrap !== 'undefined') {
            const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
            toast.show();
            toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
        } else {
            // Fallback sem bootstrap
            setTimeout(() => toastEl.remove(), 3000);
        }
    }

})();
