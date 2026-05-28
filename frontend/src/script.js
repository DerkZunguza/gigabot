const API_URL = '/api';

// Elementos DOM
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const qrContainer = document.getElementById('qr-container');
const qrImage = document.getElementById('qr-image');
const restartBtn = document.getElementById('restart-btn');
const sendForm = document.getElementById('send-form');
const messageResult = document.getElementById('message-result');
const contactForm = document.getElementById('contact-form');
const contactsList = document.getElementById('contacts-list');
const scheduledForm = document.getElementById('scheduled-form');
const messagesList = document.getElementById('messages-list');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history');

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Tab switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');
        
        // Load data when switching tabs
        if (tab === 'contacts') loadContacts();
        if (tab === 'messages') loadMessages();
        if (tab === 'history') loadHistory();
    });
});

// Verificar status periodicamente
async function checkStatus() {
    try {
        const response = await fetch(`${API_URL}/status`);
        const data = await response.json();
        
        updateStatus(data.status, data.qrCode);
    } catch (error) {
        console.error('Erro ao verificar status:', error);
    }
}

function updateStatus(status, qrCode) {
    statusIndicator.className = `status-indicator ${status}`;
    
    switch (status) {
        case 'connected':
            statusText.textContent = 'Conectado';
            qrContainer.classList.add('hidden');
            break;
        case 'qr':
            statusText.textContent = 'Aguardando QR Code';
            qrContainer.classList.remove('hidden');
            if (qrCode) {
                qrImage.src = qrCode;
            }
            break;
        case 'disconnected':
            statusText.textContent = 'Desconectado';
            qrContainer.classList.add('hidden');
            break;
        default:
            statusText.textContent = status;
    }
}

// Reiniciar conexão
restartBtn.addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_URL}/restart`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            showMessage('Reiniciando conexão...', 'success');
        } else {
            showMessage('Erro ao reiniciar', 'error');
        }
    } catch (error) {
        showMessage('Erro ao reiniciar', 'error');
    }
});

// Enviar mensagem
sendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phone = document.getElementById('phone').value;
    const message = document.getElementById('message').value;
    
    try {
        const response = await fetch(`${API_URL}/send-message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone, message })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('Mensagem enviada com sucesso!', 'success');
            sendForm.reset();
        } else {
            showMessage(data.error || 'Erro ao enviar mensagem', 'error');
        }
    } catch (error) {
        showMessage('Erro ao enviar mensagem', 'error');
    }
});

// ==================== CONTACTS CRUD ====================

async function loadContacts() {
    try {
        const response = await fetch(`${API_URL}/contacts`);
        const contacts = await response.json();
        renderContacts(contacts);
    } catch (error) {
        console.error('Erro ao carregar contatos:', error);
    }
}

function renderContacts(contacts) {
    contactsList.innerHTML = contacts.map(contact => `
        <div class="list-item">
            <div class="list-item-info">
                <div class="list-item-name">${contact.name}</div>
                <div class="list-item-phone">${contact.phone}</div>
            </div>
            <div class="list-item-actions">
                <button class="btn btn-sm btn-danger" onclick="deleteContact(${contact.id})">Excluir</button>
            </div>
        </div>
    `).join('');
}

contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('contact-name').value;
    const phone = document.getElementById('contact-phone').value;
    
    try {
        const response = await fetch(`${API_URL}/contacts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, phone })
        });
        
        if (response.ok) {
            contactForm.reset();
            loadContacts();
            showMessage('Contato adicionado!', 'success');
        }
    } catch (error) {
        showMessage('Erro ao adicionar contato', 'error');
    }
});

async function deleteContact(id) {
    try {
        const response = await fetch(`${API_URL}/contacts/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadContacts();
            showMessage('Contato excluído!', 'success');
        }
    } catch (error) {
        showMessage('Erro ao excluir contato', 'error');
    }
}

// ==================== MESSAGES CRUD ====================

async function loadMessages() {
    try {
        const response = await fetch(`${API_URL}/messages`);
        const messages = await response.json();
        renderMessages(messages);
    } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
    }
}

function renderMessages(messages) {
    messagesList.innerHTML = messages.map(msg => `
        <div class="list-item">
            <div class="list-item-info">
                <div class="list-item-phone">${msg.phone}</div>
                <div class="list-item-message">${msg.message}</div>
                <div class="list-item-time">${msg.scheduledFor ? 'Agendado: ' + new Date(msg.scheduledFor).toLocaleString() : 'Status: ' + msg.status}</div>
            </div>
            <div class="list-item-actions">
                <button class="btn btn-sm btn-success" onclick="sendMessage(${msg.id})">Enviar</button>
                <button class="btn btn-sm btn-danger" onclick="deleteMessage(${msg.id})">Excluir</button>
            </div>
        </div>
    `).join('');
}

scheduledForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phone = document.getElementById('scheduled-phone').value;
    const message = document.getElementById('scheduled-message').value;
    const scheduledFor = document.getElementById('scheduled-time').value;
    
    try {
        const response = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone, message, scheduledFor: scheduledFor || null })
        });
        
        if (response.ok) {
            scheduledForm.reset();
            loadMessages();
            showMessage('Mensagem agendada!', 'success');
        }
    } catch (error) {
        showMessage('Erro ao agendar mensagem', 'error');
    }
});

async function sendMessage(id) {
    try {
        const response = await fetch(`${API_URL}/messages/${id}`);
        const msg = await response.json();
        
        const sendResponse = await fetch(`${API_URL}/send-message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone: msg.phone, message: msg.message })
        });
        
        const data = await sendResponse.json();
        
        if (data.success) {
            // Update message status
            await fetch(`${API_URL}/messages/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'sent' })
            });
            
            loadMessages();
            showMessage('Mensagem enviada!', 'success');
        }
    } catch (error) {
        showMessage('Erro ao enviar mensagem', 'error');
    }
}

async function deleteMessage(id) {
    try {
        const response = await fetch(`${API_URL}/messages/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadMessages();
            showMessage('Mensagem excluída!', 'success');
        }
    } catch (error) {
        showMessage('Erro ao excluir mensagem', 'error');
    }
}

// ==================== HISTORY ====================

async function loadHistory() {
    try {
        const response = await fetch(`${API_URL}/history`);
        const history = await response.json();
        renderHistory(history);
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
    }
}

function renderHistory(history) {
    historyList.innerHTML = history.map(item => `
        <div class="list-item">
            <div class="list-item-info">
                <div class="list-item-phone">${item.from || item.to}</div>
                <div class="list-item-message">${item.message}</div>
                <div class="list-item-time">${new Date(item.timestamp).toLocaleString()}</div>
            </div>
        </div>
    `).join('');
}

clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Tem certeza que deseja limpar o histórico?')) {
        try {
            const response = await fetch(`${API_URL}/history`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                loadHistory();
                showMessage('Histórico limpo!', 'success');
            }
        } catch (error) {
            showMessage('Erro ao limpar histórico', 'error');
        }
    }
});

function showMessage(text, type) {
    messageResult.textContent = text;
    messageResult.className = `message-result ${type}`;
    
    setTimeout(() => {
        messageResult.textContent = '';
        messageResult.className = 'message-result';
    }, 5000);
}

// Verificar status a cada 3 segundos
checkStatus();
setInterval(checkStatus, 3000);
