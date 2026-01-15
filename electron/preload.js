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
    
    // desktopCapturer API для захвата экрана
    desktopCapturer: {
        getSources: (options) => ipcRenderer.invoke('desktop-capturer-get-sources', options),
        startScreenStream: (sourceId) => ipcRenderer.invoke('desktop-capturer-start-stream', sourceId)
    }
});

// Экспортируем desktopCapturer для прямого использования в рендере
if (window.require) {
    try {
        const { desktopCapturer } = window.require('electron');
        window.desktopCapturer = desktopCapturer;
    } catch (error) {
        console.warn('Не удалось загрузить desktopCapturer:', error);
    }
}

// Обработка ошибок в preload скрипте
process.on('uncaughtException', (error) => {
    console.error('Ошибка в preload скрипте:', error);
});