// chat.js - Логика чата с поддержкой медиа файлов

const chatDateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});

class ChatManager {
    constructor() {
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        this.sendMessageBtn = document.getElementById('sendMessageBtn');
        this.attachFileBtn = document.getElementById('attachFileBtn');
        this.fileInput = document.getElementById('fileInput');
        this.chatContainer = document.getElementById('chatContainer');
        this.dragOverlay = document.getElementById('dragOverlay');
        this.modal = document.getElementById('imageModal');
        this.modalImage = document.getElementById('modalImage');
        this.closeModal = document.querySelector('.close');
        
        this.currentUserUUID = window.currentUserUUID || '';
        this.currentUsername = window.currentUsername || '';
        this.ws = null; // Будет установлено после подключения
        
        this.initEventListeners();
        this.loadRecentMessages();
    }
    
    initEventListeners() {
        // Отправка сообщения по клику
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        
        // Отправка сообщения по Enter (без Shift)
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Прикрепление файла
        this.attachFileBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Drag and drop для файлов на весь контейнер чата
        this.chatContainer.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.chatContainer.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.chatContainer.addEventListener('drop', (e) => this.handleFileDrop(e));
        
        // Вставка файлов через Ctrl+V (только для чата)
        this.pasteHandler = (e) => this.handlePaste(e);
        // Добавляем обработчик только на поле ввода чата
        this.chatInput.addEventListener('paste', this.pasteHandler);
        
        // Модальное окно
        this.closeModal.addEventListener('click', () => this.hideModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hideModal();
            }
        });
        
        // Закрытие модального окна по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideModal();
            }
        });
    }
    
    sendMessage() {
        const content = this.chatInput.value.trim();
        if (!content) return;
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.showSystemMessage('Ошибка: нет подключения к серверу');
            console.log('❌ WebSocket не подключен, состояние:', this.ws ? this.ws.readyState : 'не определено');
            return;
        }
        
        console.log('📤 Отправка сообщения через WebSocket:', content);
        
        try {
            // Отправляем сообщение через WebSocket (глобальный чат, не требует комнаты)
            this.ws.send(JSON.stringify({
                type: 'chat_message',
                content: content,
                message_type: 'text',
            }));
            
            // Очищаем поле ввода только после успешной отправки
            this.chatInput.value = '';
            this.chatInput.style.height = 'auto';
            
            console.log('✓ Сообщение отправлено в глобальный чат');
        } catch (error) {
            console.error('❌ Ошибка отправки сообщения:', error);
            this.showSystemMessage('Ошибка отправки сообщения');
        }
    }
    
    async handleFileSelect(event) {
        const files = Array.from(event.target.files);
        await this.uploadFiles(files);
        event.target.value = '';
    }
    
    async handleFileDrop(event) {
        event.preventDefault();
        this.chatContainer.classList.remove('dragover');
        this.dragOverlay.style.display = 'none';
        
        const files = Array.from(event.dataTransfer.files);
        await this.uploadFiles(files);
    }
    
    handleDragOver(event) {
        event.preventDefault();
        this.chatContainer.classList.add('dragover');
        this.dragOverlay.style.display = 'flex';
    }
    
    handleDragLeave(event) {
        event.preventDefault();
        if (!this.chatContainer.contains(event.relatedTarget)) {
            this.chatContainer.classList.remove('dragover');
            this.dragOverlay.style.display = 'none';
        }
    }
    
    async handlePaste(event) {
        const items = event.clipboardData.items;
        const files = [];
        
        for (let item of items) {
            if (item.type.indexOf('image') !== -1 || item.type.indexOf('video') !== -1) {
                const file = item.getAsFile();
                if (file) {
                    files.push(file);
                }
            }
        }
        
        if (files.length > 0) {
            // Полностью предотвращаем стандартное поведение браузера при вставке файлов
            event.preventDefault();
            event.stopPropagation();
            await this.uploadFiles(files);
        }
    }
    
    async uploadFiles(files) {
        if (!files || files.length === 0) return;
        
        for (let file of files) {
            await this.uploadFile(file);
        }
    }
    
    async uploadFile(file) {
        try {
            // Проверяем тип файла
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');
            
            if (!isImage && !isVideo) {
                this.showSystemMessage(`Ошибка: неподдерживаемый тип файла ${file.name}`);
                return;
            }
            
            // Проверяем размер файла (макс 50MB)
            if (file.size > 50 * 1024 * 1024) {
                this.showSystemMessage(`Ошибка: файл ${file.name} слишком большой (макс 50MB)`);
                return;
            }
            
            this.showSystemMessage(`Загрузка ${file.name}...`);
            
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch(`${window.BACKEND_URL}/api/upload?user=${this.currentUserUUID}`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status === 'ok') {
                this.showSystemMessage(`Файл ${file.name} успешно загружен`);
                
                // Отправляем медиа-сообщение в глобальный чат через WebSocket
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'chat_message',
                        content: data.file.url,
                        message_type: 'media',
                        user_uuid: this.currentUserUUID
                    }));
                    console.log('✓ Медиа-сообщение отправлено в глобальный чат');
                }
            } else {
                this.showSystemMessage(`Ошибка загрузки ${file.name}: ${data.error}`);
            }
            
        } catch (error) {
            console.error('Upload error:', error);
            this.showSystemMessage(`Ошибка загрузки файла: ${error.message}`);
        }
    }
    
    displayMessage(messageData) {
        const messageElement = this.createMessageElement(messageData);
        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }
    
    createMessageElement(messageData) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        // Проверяем, свое ли это сообщение
        const isOwn = messageData.isOwn || (messageData.user_uuid === this.currentUserUUID);
        if (isOwn) {
            messageDiv.classList.add('own');
        }
        
        // Аватар
        const avatar = document.createElement('div');
        avatar.className = 'chat-message-avatar';
        
        const img = new Image();
        const avatarUrl = `${window.BACKEND_URL}/static/avatars/${messageData.user_uuid}_avatar.jpg`
        img.src = avatarUrl;
        img.onload = () => {
            // Картинка есть, ставим её
            avatar.style.backgroundImage = `url(${avatarUrl})`;
            avatar.style.backgroundSize = 'cover';
            avatar.style.backgroundPosition = 'center';
            avatar.textContent = '';
        };

        img.onerror = () => {
            // Ошибка — ставим только цвет и букву
            avatar.style.background = 'hsl(248, 53%, 58%)';
            avatar.textContent = (messageData.username || 'U').charAt(0).toUpperCase();
        };
        
        // Контент
        const content = document.createElement('div');
        content.className = 'chat-message-content';
        
        // Имя пользователя
        const username = document.createElement('div');
        username.className = 'chat-message-username';
        username.textContent = messageData.username || 'Unknown';
        
        // Текст/медиа
        const text = document.createElement('div');
        text.className = 'chat-message-text';
        
        // Время
        const time = document.createElement('div');
        time.className = 'chat-message-time';
        const messageTime = new Date(messageData.datetime);
        time.textContent = chatDateFormatter.format(messageTime);
        
        content.appendChild(username);
        
        // Если это медиа-сообщение
        if (messageData.type === 'media' || messageData.message_type === 'media') {
            messageDiv.classList.add('media-message');
            
            const mediaUrl = messageData.content;
            const fileExt = mediaUrl.split('.').pop().toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(fileExt);
            const isVideo = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv'].includes(fileExt);
            
            if (isImage) {
                const mediaContainer = document.createElement('div');
                mediaContainer.className = 'chat-media';
                
                const img = document.createElement('img');
                img.src = mediaUrl;
                img.alt = 'Изображение';
                img.loading = 'lazy';
                img.addEventListener('load', () => {
                    this.scrollToBottom();
                }, { once: true });
                img.addEventListener('click', () => this.showModal(mediaUrl));
                
                mediaContainer.appendChild(img);
                text.appendChild(mediaContainer);
            } else if (isVideo) {
                const mediaContainer = document.createElement('div');
                mediaContainer.className = 'chat-media';
                
                const video = document.createElement('video');
                video.src = mediaUrl;
                video.controls = true;
                video.autoplay = false;
                video.preload = 'metadata';

                if (video.readyState < 2) {
                    video.addEventListener('loadeddata', () => {
                        this.scrollToBottom()
                    }, { once: true });
                }
                
                mediaContainer.appendChild(video);
                text.appendChild(mediaContainer);
            } else {
                text.textContent = mediaUrl;
            }
        } else {
            // Текстовое сообщение
            text.textContent = messageData.content;
        }
        
        content.appendChild(text);
        content.appendChild(time);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        
        return messageDiv;
    }
    
    showSystemMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message system';
        messageDiv.innerHTML = `
            <div class="chat-message-content">
                <div class="chat-message-text" style="color: #999; font-style: italic; text-align: center;">
                    ${text}
                </div>
            </div>
        `;
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    setWebSocket(websocket) {
        this.ws = websocket;
        console.log('✓ WebSocket установлен в ChatManager');
    }
    
    showModal(imageUrl) {
        this.modalImage.src = imageUrl;
        this.modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
    
    hideModal() {
        this.modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        this.modalImage.src = '';
    }
    
    async loadRecentMessages() {
        try {
            const response = await fetch(`${window.BACKEND_URL}/api/messages?user=${currentUserUUID}&limit=50`);
            const data = await response.json();
            
            if (data.status === 'ok') {
                // Очищаем чат
                this.chatMessages.innerHTML = '';
                
                // Загружаем сообщения в обратном порядке (самые старые сначала)
                const messages = data.messages.reverse();
                messages.forEach(msg => {
                    // При загрузке из БД помечаем свои сообщения
                    if (msg.user_uuid === this.currentUserUUID) {
                        msg.isOwn = true;
                    }
                    this.displayMessage(msg);
                });
                this.scrollToBottom();
            }
        } catch (error) {
            console.error('Failed to load messages:', error);
        }
    }
    
    // Обработчик сообщений от WebSocket
    handleChatMessage(data) {
        console.log('📨 ChatManager получил сообщение:', data);
        
        // Проверяем, свое ли это сообщение
        const isOwn = (data.user_uuid === this.currentUserUUID);
        
        this.displayMessage({
            type: data.message_type,
            content: data.content,
            username: data.username,
            user_uuid: data.user_uuid,
            datetime: data.datetime,
            isOwn: isOwn
        });
    }
    
    // Метод для очистки ресурсов
    destroy() {
        // Удаляем обработчик вставки с конкретных элементов
        if (this.pasteHandler) {
            this.chatInput.removeEventListener('paste', this.pasteHandler);
            console.log('✓ Обработчик вставки удален');
        }
    }
}

// Инициализация чата после загрузки данных пользователя
function initializeChat() {
    // Проверяем, не был ли ChatManager уже инициализирован
    if (window.chatManager && window.chatManager instanceof ChatManager) {
        return;
    }
    
    console.log('Инициализация ChatManager...');
    
    // Создаем chatManager с данными пользователя
    window.chatManager = new ChatManager();
    console.log('✓ ChatManager создан');
    
    // Ждем пока WebSocket подключится
    const waitForWebSocket = setInterval(() => {
        if (window.ws) {
            console.log('   WebSocket состояние:', window.ws.readyState);
            
            if (window.ws.readyState === WebSocket.OPEN) {
                window.chatManager.setWebSocket(window.ws);
                console.log('✓ Чат инициализирован с WebSocket соединением');
                clearInterval(waitForWebSocket);
                return;
            } else if (window.ws.readyState === WebSocket.CLOSED) {
                console.log('✗ WebSocket соединение закрыто');
                clearInterval(waitForWebSocket);
            }
        } else {
            console.log('   WebSocket еще не создан...');
        }
    }, 100);
}

// Экспорт для использования в других скриптах
window.ChatManager = ChatManager;