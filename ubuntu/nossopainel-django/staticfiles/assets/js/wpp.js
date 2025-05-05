// Variáveis globais
const generate_token_url = '/generate-token';
const check_connection_session_url = '/check-connection-session';
let intervalId = null;

// FUNÇÃO DE CONTROLE 1: connect
async function connect() {
    const user = document.getElementById('user-session').value;
    const showQrCodeDiv = document.getElementById('show-qrcode');
    const cookieName = `token-wpp-${user}`;

    showQrCodeDiv.innerHTML = "";
    showQrCodeDiv.innerHTML = "<p class='mt-1 mb-0'>Gerando QRCode. Aguarde!</p>";

    startSession();

    if (document.cookie.includes(cookieName)) { // verifica se existe o cookie com o token da sessão
        intervalId = setInterval(checkSession, 15000);

    } else {
        const token_backend = getTokenBackend(user);

        if (token_backend != undefined && token_backend != null) { // verifica se existe o token no backend para criar o cookie
            createCookie(token_backend);
            console.log('connect - createCookie: Cookie criado!')
            intervalId = setInterval(checkSession, 15000);

        } else {
            getSessionToken(); // gera novo token caso não esteja salvo no cookie e nem no backend
            console.log('connect - getSessionToken: Novo token gerado!')
            intervalId = setInterval(checkSession, 15000);
        }
    }
}

// FUNÇÃO DE CONTROLE 2: check session
function checkSession() {
    const showQrCodeDiv = document.getElementById('show-qrcode');
    const btnDesconectar = document.getElementById('desconectar');
    const btnConectar = document.getElementById('conectar');

    loadQrcode().then(response => {
        console.log('Status sessão WPP: ', response.status);
        const status = response.status;
        console.log('loadQrcode - Status: ', response);

        if (status === 'CLOSED') {
            startSession();
            showQrCodeDiv.innerHTML = "";
            showQrCodeDiv.innerHTML = "<p class='mt-1 mb-0'>Gerando QRCode. Aguarde!</p>";

        } else if (status === 'INITIALIZING' || status === 'QRCODE' || status === 'qrcode') {
            btnDesconectar.disabled = true;

        } else if (status === 'CONNECTED') {
            clearInterval(intervalId);
            btnDesconectar.disabled = false;
            btnConectar.disabled = true;
            showQrCodeDiv.innerHTML = "";
            showQrCodeDiv.innerHTML = '<span class="badge rounded-pill bg-success"><iconify-icon icon="feather:check-circle" style="color: white;"></iconify-icon> DISPOSITIVO CONECTADO</span>';
        }
    })
    .catch(error => {
        console.error('Ocorreu um erro:', error);
    });
}

// FUNÇÃO DE CONTROLE 3: logout
function logout() {
    deletarSessionToken();
    deleteSession();
    deleteCookie();
    
    setTimeout(function() {
        window.location.reload();
    }, 2000);
    modal_whatsapp();
}

// FUNÇÃO DE API 1: get session token
async function getSessionToken() {
    const stkn = await get_stkn();
    const base_url = 'http://wppconnect-server:21465/api/';
    const user = document.getElementById('user-session').value;
    const url = base_url + user + '/' + stkn + generate_token_url;

    fetch(url, {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        },
        })
        .then(response => response.text())
        .then(responseText => {

        // Obter o token do responseText
        const token = JSON.parse(responseText).token;

        // Criar cookie com o token
        createCookie(token);

        // Salvar o token no banco de dados
        salvarSessionToken(token);
        });
}

// FUNÇÃO DE API 2: start session
function startSession() {
    const base_url = 'http://wppconnect-server:21465/api/';
    const start_session_url = '/start-session';
    const user = document.getElementById('user-session').value;
    const url = base_url + user + start_session_url;
    const cookieName = `token-wpp-${user}`;
    const token = getCookie(cookieName);

    const requestBody = {
        webhook: null,
        waitQrCode: true
    };

    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
    })
    .then(response => response.json())
    .then(responseJson => {
        console.log('startSession - Response: ', responseJson);
        return responseJson;
    })
    .catch(error => {
        console.error('Ocorreu um erro:', error);
        throw error;
    });
}

// FUNÇÃO DE API 3: load qrcode
async function loadQrcode() {
    const status_session_url = '/status-session';
    const base_url = 'http://wppconnect-server:21465/api/';
    const user = document.getElementById('user-session').value;
    const cookieName = `token-wpp-${user}`;
    const token = getCookie(cookieName);
    const url = base_url + user + status_session_url;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            },
        });
        const responseJson = await response.json();
        const qrcode = responseJson.qrcode;
        const showQrCodeDiv = document.getElementById('show-qrcode');
        showQrCodeDiv.innerHTML = '';
        const qrCodeImage = document.createElement('img');
        qrCodeImage.src = qrcode;
        showQrCodeDiv.appendChild(qrCodeImage);
        return responseJson;
        
    } catch (error) {
        console.error('Ocorreu um erro:', error);
        throw error;
    }
}


// FUNÇÃO AUXILIAR 1: criação do cookie com token da sessão WhatsApp do usuário
function createCookie(token) {
    const expirationDate = new Date('9999-12-31');
    const user = document.getElementById('user-session').value;
    const cookieName = `token-wpp-${user}`;
    const cookieOptions = {
        path: '/dashboard/', // Define o caminho do cookie
        expires: expirationDate.toUTCString(), // define expiração do cookie
    };
    document.cookie = `${cookieName}=${token}; path=${cookieOptions.path}; expires=${cookieOptions.expires}`;
}

// FUNÇÃO AUXILIAR 2: deletar o cookie "token-wpp"
function deleteCookie() {
    const expirationDate = new Date('2000-01-01');  // Define uma data passada
    const user = document.getElementById('user-session').value;
    const cookieName = `token-wpp-${user}`;
    const cookieOptions = {
        path: '/dashboard/', // Define o caminho do cookie
        expires: expirationDate.toUTCString(), // Define a expiração do cookie
    };
    document.cookie = `${cookieName}=; path=${cookieOptions.path}; expires=${cookieOptions.expires}`;
}

// Função para deletar a sessão do usuário logado
function deleteSession() {
    const logout_session = '/logout-session'
    const base_url = 'http://wppconnect-server:21465/api/';
    const user = document.getElementById('user-session').value;
    const url = base_url + user + logout_session;
    const cookieName = `token-wpp-${user}`;
    const token = getCookie(cookieName);

    fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
    },
    })
    .then(response => response.text())
    .then(responseText => {
        console.log('Sessão encerrada: ', responseText);
        deleteCookie(cookieName);
    })
    .catch(error => {
        console.error('Ocorreu um erro:', error);
    });
}

// Função de exibição do modal da sessão do WhatsApp
function modal_whatsapp() {
    $('#qrcode-modal').modal('show');

    $('#qrcode-modal').on('click', '.btn-close, .btn-secondary', function () {
        $('#qrcode-modal').modal('hide');
    });
}

// Função para obter o valor do cookie "token-wpp"
function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(`${name}=`)) {
        return cookie.substring(name.length + 1);
    }
    }
    return null;
}

// Requisições para API Django (obter dados da sessão salva)
function getTokenBackend() {
    const url = '/obter_session_wpp/'
    fetch(url, {
        method: 'GET',
        headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken')
        },
    })
    .then(response => response.json())
    .then(responseJson => {
    const token = responseJson.token;
    })
    .catch(error => {
    console.error('Ocorreu um erro:', error);
    });
}

// Requisições para API Django (salvar token da sessão WhatsApp)
function salvarSessionToken(token) {
    const url = '/session_wpp/';
    const data = {
        token: token
    };

    fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify(data),
    })
    .then(response => response.json())
    .then(responseData => {
        console.log('Salvando token no backend:', responseData);
    })
    .catch(error => {
        console.error('Erro ao tentar salvar token no backend: ', error);
    });
}

// Requisições para API Django (deletar token da sessão WhatsApp)
function deletarSessionToken() {
    const user = document.getElementById('user-session').value;
    const url = '/session_wpp/';
    const cookieName = `token-wpp-${user}`;
    const token = getCookie(cookieName);
    const data = {
        token: token
    };

    fetch(url, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify(data),
    })
    .then(response => response.json())
    .then(responseData => {
        console.log('Token deletado do backend:', responseData);
        // Realizar ações adicionais após deletar o token, se necessário
    })
    .catch(error => {
        console.error('Erro ao tentar deletar token no backend: ', error);
    });
}

// Requisições para API Django (obter stkn)
async function get_stkn() {
    const url = '/obter_stkn/';

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
        });
        const responseData = await response.json();
        const data_1 = responseData.stkn;
        return data_1;
    } catch (error) {
        console.error('Error', error);
        throw error;
    }
}


// Função para envio das mensagens avulsas
function enviarMensagemWpp() {
    var telefones = document.getElementById('telefones').value.split(',');
    var mensagem = document.getElementById('mensagem').value;
    var imagemInput = document.getElementById('imagem');
    var imagem = imagemInput.files[0];
    var token = ''; // Preencha com o token de autenticação

    var resultado = {};

    if (imagem) {
        var url = 'http://wppconnect-server:21465/api/' + usuario + '/send-file';

        var formData = new FormData();
        formData.append('message', mensagem);
        formData.append('isGroup', false);
        formData.append('file', imagem);

        telefones.forEach(function(telefone) {
            formData.append('phone', telefone);

            var request = new XMLHttpRequest();
            request.open('POST', url, true);
            request.setRequestHeader('Authorization', 'Bearer ' + token);

            request.onreadystatechange = function() {
                if (request.readyState === 4) {
                    if (request.status === 200 || request.status === 201) {
                        resultado[telefone] = 'Mensagem enviada';
                    } else {
                        resultado[telefone] = 'Sem WhatsApp';
                    }

                    if (Object.keys(resultado).length === telefones.length) {
                        // Todos os envios foram processados
                        console.log(resultado);
                    }
                }
            };

            request.send(formData);
        });
    } else {
        var url = 'http://wppconnect-server:21465/api/' + usuario + '/send-message';

        telefones.forEach(function(telefone) {
            var body = {
                phone: telefone,
                message: mensagem,
                isGroup: false
            };

            var request = new XMLHttpRequest();
            request.open('POST', url, true);
            request.setRequestHeader('Content-Type', 'application/json');
            request.setRequestHeader('Authorization', 'Bearer ' + token);

            request.onreadystatechange = function() {
                if (request.readyState === 4) {
                    if (request.status === 200 || request.status === 201) {
                        resultado[telefone] = 'Mensagem enviada';
                    } else {
                        resultado[telefone] = 'Sem WhatsApp';
                    }

                    if (Object.keys(resultado).length === telefones.length) {
                        // Todos os envios foram processados
                        console.log(resultado);
                    }
                }
            };

            request.send(JSON.stringify(body));
        });
    }
}