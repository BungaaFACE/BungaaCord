const { contextBridge, ipcRenderer } = require('electron');

// Экспонируем API в рендер-процесс
contextBridge.exposeInMainWorld('electronAPI', {
    // Получение версии приложения
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // Получение UUID пользователя
    getUserUuid: () => ipcRenderer.invoke('get-user-uuid'),
    
    // Диалоговые окна
    showMessage: (options) => ipcRenderer.invoke('show-message-box', options),
    showError: (title, content) => ipcRenderer.invoke('show-error-dialog', title, content),
    
    // События обновления
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
    onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', callback),
    onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
    
    // Удаление слушателей
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
    

    startElectronScreenConstraints: async () => {
        const sources = await ipcRenderer.invoke('get-screen-sources');

        const source = await showScreenSelectionUI(sources);
        const constraints = {
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: source.id,
                    minWidth: 1280,
                    maxWidth: 1920,
                    minHeight: 720,
                    maxHeight: 1080,
                    minFrameRate: 30,
                    maxFrameRate: 60
                }
            }
        };
        return constraints
    },


    startAudioCapture: async (target_handle) => {
        try {
            const result = await ipcRenderer.invoke('start-audio-capture', target_handle);
            console.log('Результат запуска аудио захвата:', result);
            
            if (result.success) {
                console.log(`✓ Успешно запущен захват для PID: ${result.successfulPids.join(', ')}`);
                if (result.failedPids.length > 0) {
                    console.warn(`⚠ Не удалось запустить захват для PID: ${result.failedPids.join(', ')}`);
                }
            } else {
                console.error('❌ Ошибка запуска аудио захвата:', result.error);
            }
            
            return result;
        } catch (error) {
            console.error('Ошибка вызова startAudioCapture:', error);
            return { success: false, error: error.message };
        }
    },
    
    // Остановка аудио захвата
    stopAudioCapture: async () => {
        try {
            const result = await ipcRenderer.invoke('stop-audio-capture');
            console.log('Результат остановки аудио захвата:', result);
            
            if (result.success) {
                console.log(`✓ Успешно остановлен захват для PID: ${result.stoppedPids.join(', ')}`);
            } else {
                console.error('❌ Ошибка остановки аудио захвата:', result.error);
            }
            
            return result;
        } catch (error) {
            console.error('Ошибка вызова stopAudioCapture:', error);
            return { success: false, error: error.message };
        }
    },
    
    // Подписка на аудио данные
    onAudioData: (callback) => {
        ipcRenderer.on('audio-data', (event, data) => {
            callback(data);
        });
    },
    
    // Подписка на ошибки аудио
    onAudioError: (callback) => {
        ipcRenderer.on('audio-error', (event, error) => {
            callback(error);
        });
    },
    
});

async function showScreenSelectionUI(sources) {
    // Создаем модальное окно
    const modal = createSelectionModal();
    
    return new Promise((resolve, reject) => {
        populateSourcesList(sources, modal, resolve, reject)
    });
}

// Функция создания модального окна для выбора источника стриминга
function createSelectionModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const container = document.createElement('div');
    container.style.cssText = `
        background: #2c2f33;
        border: 1px solid #4f545c;
        border-radius: 8px;
        padding: 20px;
        max-width: 80%;
        max-height: 80vh;
        overflow-y: auto;
    `;
    
    container.innerHTML = `
        <h3 style="color: #ffffff; margin-bottom: 15px;">Выберите источник экрана</h3>
        <div id="sources-list"></div>
    `;
    
    modal.appendChild(container);
    document.body.appendChild(modal);
    
    return modal;
}

// Функция заполнения списка источников
function populateSourcesList(sources, modal, resolve, reject) {
    const sourcesList = modal.querySelector('#sources-list');
    
    sources.forEach(source => {
        console.log(source)
        const sourceItem = document.createElement('div');
        sourceItem.style.cssText = `
            display: flex;
            align-items: center;
            padding: 10px;
            margin: 5px 0;
            background: #40444b;
            border-radius: 5px;
            cursor: pointer;
            transition: background 0.2s;
        `;
        
        sourceItem.innerHTML = `
            <img src="${source.thumbnail.toDataURL()}" style="width: 60px; height: 40px; margin-right: 10px; border-radius: 3px;">
            <span style="color: #ffffff;">${source.name}</span>
        `;
        
        sourceItem.addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(source);
        });


        
        sourcesList.appendChild(sourceItem);
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
            reject({ __isRejected: true });
            }
        });
}

// Обработка ошибок в preload скрипте
process.on('uncaughtException', (error) => {
    console.error('Ошибка в preload скрипте:', error);
});