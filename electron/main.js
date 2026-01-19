const { app, BrowserWindow, ipcMain, dialog, Menu, session, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fs = require('fs');
const os = require('os');
// electron/main.js
const { getActiveWindowProcessIds, startAudioCapture, stopAudioCapture } = require('application-loopback');
require('dotenv').config();

// Настройка логирования
log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow;
let userUuid = null;
let audioCapturePids = [];

if (process.platform === 'win32') {
    app.setAppUserModelId(app.name)
}

// Функция для получения пути к файлу с UUID
function getUserUuidFilePath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'user_uuid.json');
}

// Функция для загрузки UUID из файла
function loadUserUuid() {
    try {
        const filePath = getUserUuidFilePath();
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return data.uuid;
        }
    } catch (error) {
        log.error('Ошибка загрузки UUID:', error);
    }
    return null;
}

// Функция для сохранения UUID в файл
function saveUserUuid(uuid) {
    try {
        const filePath = getUserUuidFilePath();
        const data = { uuid: uuid };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        log.info(`UUID сохранен: ${uuid}`);
    } catch (error) {
        log.error('Ошибка сохранения UUID:', error);
    }
}

// Функция для запроса UUID пользователя
async function requestUserUuid() {
    return new Promise((resolve) => {
        const { BrowserWindow } = require('electron');
        
        // Создаем временное окно для ввода UUID
        const inputWindow = new BrowserWindow({
            width: 1280,
            height: 800,
            modal: true,
            parent: mainWindow,
            show: false,
            frame: true,
            resizable: false,
            title: 'Пожалуйста введите ваш UUID',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        inputWindow.loadFile(path.join(__dirname, 'build', 'input.html'));

        inputWindow.once('ready-to-show', () => {
            inputWindow.show();
        });

        // Обработка результата
        inputWindow.webContents.on('did-finish-load', () => {
            inputWindow.webContents.send('show-input-dialog');
        });

        ipcMain.once('user-uuid-input', (event, uuid) => {
            inputWindow.close();
            if (uuid && uuid.trim()) {
                saveUserUuid(uuid.trim());
                resolve(uuid.trim());
            } else {
                app.quit();
                resolve(null);
            }
        });

        inputWindow.on('closed', () => {
            resolve(null);
        });
    });
}

async function createWindow() {
    // Загружаем UUID пользователя
    userUuid = loadUserUuid();
    
    // Если UUID не найден, запрашиваем его
    if (!userUuid) {
        userUuid = await requestUserUuid();
        if (!userUuid) {
            return; // Пользователь отменил ввод
        }
    }

    // Создание окна браузера
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'build', 'icon.ico'),
        title: 'BungaaCord Desktop',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false, // Скрыть окно до полной загрузки
        frame: true, // Показать стандартную рамку окна
        titleBarStyle: 'default',
        backgroundColor: '#2c2f33'
    });

    // Загрузка приложения
    const serverUrl = process.env.SERVER_URL || 'https://bungaacord.bungaa-server.ru';
    const ignoreSsl = process.env.IGNORE_SSL === 'true';
    
    // Настройка SSL игнора если включено
    if (ignoreSsl) {
        console.log('IGNORE_SSL mode enabled - disabling SSL certificate verification');
        
        // Отключаем проверку SSL для всех запросов
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            callback({ cancel: false });
        });
        
        // Добавляем обработку для игнорирования ошибок сертификата
        session.defaultSession.setCertificateVerifyProc((request, callback) => {
            console.log('Certificate verification bypassed for:', request.url);
            // Всегда возвращаем 0 (успешная проверка)
            callback(0);
        });
        
        // Отключаем проверку безопасности для загрузки контента
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            // Удаляем заголовки безопасности, которые могут блокировать загрузку
            const responseHeaders = details.responseHeaders || {};
            
            // Удаляем заголовки, связанные с безопасностью
            delete responseHeaders['content-security-policy'];
            delete responseHeaders['strict-transport-security'];
            delete responseHeaders['x-content-type-options'];
            delete responseHeaders['x-frame-options'];
            delete responseHeaders['x-xss-protection'];
            
            callback({
                responseHeaders: responseHeaders,
                statusLine: details.statusLine
            });
        });
    }
    
    // Загружаем главную страницу с UUID пользователя
    mainWindow.loadURL(`${serverUrl}/?user=${userUuid}`, {
        extraHeaders: ignoreSsl ? 'pragma: no-cache\n' : ''
    });

    // Показать окно после полной загрузки
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Обработка ошибок загрузки
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Ошибка загрузки страницы:', errorDescription);
        // Показываем страницу с ошибкой, передавая параметры
        const errorParams = new URLSearchParams({
            error: errorDescription,
            server: validatedURL,
            user: userUuid
        });
        mainWindow.loadURL(`file://${path.join(__dirname, 'build', 'error.html')}?${errorParams.toString()}`);
    });

    // Обработка закрытия окна
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Создание меню
    createMenu();
}

function createMenu() {
    const template = [
        {
            label: 'Файл',
            submenu: [
                {
                    label: 'Перезапустить',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.reload();
                        }
                    }
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Изменить UUID',
                    click: async () => {
                        const newUuid = await requestUserUuid();
                        if (newUuid && mainWindow) {
                            const serverUrl = process.env.SERVER_URL || 'https://bungaacord.bungaa-server.ru';
                            mainWindow.loadURL(`${serverUrl}/?user=${newUuid}`);
                        }
                    }
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Закрыть',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Вид',
            submenu: [
                {
                    label: 'Перезагрузить',
                    accelerator: 'F5',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.reload();
                        }
                    }
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Полноэкранный режим',
                    accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.setFullScreen(!mainWindow.isFullScreen());
                        }
                    }
                },
                {
                    label: 'Режим разработчика',
                    accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.toggleDevTools();
                        }
                    }
                }
            ]
        },
        {
            label: 'Справка',
            submenu: [
                {
                    label: 'О приложении',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'О BungaaCord Desktop',
                            message: 'BungaaCord Desktop',
                            detail: 'Версия: 1.0.0\n\nДесктопный клиент для голосового чата BungaaCord'
                        });
                    }
                },
                {
                    label: 'Проверить обновления',
                    click: () => {
                        checkForUpdates();
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// IPC обработчики
ipcMain.on('get-app-version', (event) => {
    event.reply('get-app-version', app.getVersion());
});

ipcMain.on('get-user-uuid', (event) => {
    event.reply('get-user-uuid', userUuid);
});

ipcMain.on('show-message-box', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options);
    event.reply('show-message-box-result', result);
});

ipcMain.on('show-error-dialog', async (event, title, content) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: title,
        message: title,
        detail: content
    });
    event.reply('show-error-dialog-result', result);
});

function checkForUpdates() {
    autoUpdater.checkForUpdatesAndNotify();
}

autoUpdater.on('checking-for-update', () => {
    console.log('Проверка обновлений...');
});

autoUpdater.on('update-available', (info) => {
    console.log('Доступно обновление:', info.version);
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Доступно обновление',
        message: 'Доступно обновление BungaaCord Desktop',
        detail: `Версия ${info.version} доступна для загрузки. Приложение будет обновлено автоматически.`,
        buttons: ['OK']
    });
});

autoUpdater.on('update-not-available', (info) => {
    console.log('Обновления не доступны');
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Обновления не найдены',
        message: 'У вас установлена последняя версия приложения',
        buttons: ['OK']
    });
});

autoUpdater.on('error', (err) => {
    console.error('Ошибка обновления:', err);
    dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Ошибка обновления',
        message: 'Произошла ошибка при проверке обновлений',
        detail: err.toString(),
        buttons: ['OK']
    });
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Скачивание обновления: " + progressObj.percent + "%";
    console.log(log_message);
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('Обновление скачано');
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Обновление готово',
        message: 'Обновление BungaaCord Desktop готово к установке',
        detail: 'Приложение будет перезапущено для установки обновления.',
        buttons: ['Обновить сейчас', 'Позже']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});


ipcMain.handle('get-screen-sources', async (event) => {
    const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 } // Уменьшаем размер для ускорения
    });
    
    return sources
});

ipcMain.handle('start-audio-capture', async (event, target_handle) => {
    try {
        const target_pids = [];
        // Останавливаем предыдущие захваты
        Object.values(audioCapturePids).forEach(capturePID => {
            stopAudioCapture(capturePID);
        });
        audioCapturePids = [];

        const windows = await getActiveWindowProcessIds();
        // System Audio
        if (!target_handle) {
            const render_window_pid = process.pid.toString();
            // add all except app window
            windows.forEach((win) => {
                if (win.processId !== render_window_pid) {
                    target_pids.push(win.processId);
                    console.log(`${win.processId} - ${win.title}`);
                }
            });
        // Specific window
        } else {
            for (const win of windows) {
                if (win.hwnd === target_handle) {
                    target_pids.push(win.processId);
                    console.log(`${win.processId} - ${win.title}`);
                    break;
                }
            }
        }

        for (const pid of target_pids) {
            try {
                if (!audioCapturePids.includes(pid)) {
                    const capturePid = startAudioCapture(pid, {
                        onData: (chunk) => {
                            // Отправляем данные в рендер-процесс
                            if (event.sender) {
                                event.sender.send('audio-data', {
                                    pid: pid,
                                    data: Array.from(chunk), // Преобразуем Uint8Array в массив для сериализации
                                    timestamp: Date.now()
                                });
                            }
                        },
                        onError: (error) => {
                            console.error(`Ошибка аудио захвата для PID ${pid}:`, error);
                            if (event.sender) {
                                event.sender.send('audio-error', {
                                    pid: pid,
                                    error: error.message
                                });
                            }
                        }
                    });
                    if (capturePid) {
                        audioCapturePids.push(capturePid)
                    }
                    console.log(`Аудио захват запущен для PID: ${pid}`)
                }
            } catch (error) {
                console.error(`Не удалось запустить аудио захват для PID ${pid}:`, error);
            }
        };
        return {
            success: true,
            message: `Аудио захват запущен для ${audioCapturePids.length} процессов`,
            successfulPids: audioCapturePids,
            failedPids: target_pids.filter(pid => !audioCapturePids.includes(pid))
        };
    } catch (error) {
        console.error('Ошибка при получении аудио источников:', error);
        return {
            success: false,
            error: error.message,
            successfulPids: [],
            // failedPids: target_pids
        };
    }
});

// Обработчик для остановки аудио захвата
ipcMain.handle('stop-audio-capture', async (event) => {
    try {
        console.log('Остановка аудио захвата...');
        stoppedPids = []
        Object.values(audioCapturePids).forEach(capturePID => {
            const stopped = stopAudioCapture(capturePID);
            if (stopped) stoppedPids.push(capturePID);
        });
        audioCapturePids = [];
        
        return {
            success: true,
            message: `Аудио захват остановлен для ${stoppedPids.length} процессов`,
            stoppedPids: stoppedPids
        };
        
    } catch (error) {
        console.error('Ошибка при остановке аудио захвата:', error);
        return {
            success: false,
            error: error.message,
            stoppedPids: []
        };
    }
});


// События приложения
app.whenReady().then(async () => {
    await createWindow();
    registerGlobalShortcuts();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Здесь можно добавить очистку ресурсов
});

// IPC обработчики для горячих клавиш
ipcMain.on('switch-mute-button', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('execute-switch-mute-button');
    }
});

ipcMain.on('switch-mute-all-button', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('execute-switch-mute-all-button');
    }
});

// Настройка горячих клавиш
function registerGlobalShortcuts() {
    // PageDown - переключение кнопки микрофона
    globalShortcut.register('PageDown', () => {
        console.log('Нажата PageDown - переключение микрофона');
        ipcMain.emit('switch-mute-button');
    });

    // PageUp - переключение кнопки заглушки звука
    globalShortcut.register('PageUp', () => {
        console.log('Нажата PageUp - переключение заглушки звука');
        ipcMain.emit('switch-mute-all-button');
    });

    console.log('Глобальные горячие клавиши зарегистрированы');
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Обработка неожиданных ошибок
process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
    log.error('Необработанная ошибка:', error);
    
    if (mainWindow) {
        dialog.showErrorBox('Критическая ошибка', 'Произошла критическая ошибка. Приложение будет перезапущено.');
        app.relaunch();
        app.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Необработанный Promise отклонение:', reason);
    log.error('Необработанный Promise отклонение:', reason);
});