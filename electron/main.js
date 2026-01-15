const { app, BrowserWindow, ipcMain, dialog, Menu, session, desktopCapturer } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

// Настройка логирования
log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow;
let userUuid = null;

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
    const serverUrl = process.env.SERVER_URL || 'http://localhost:8080';
    const ignoreSsl = process.env.IGNORE_SSL === 'true';
    
    // Настройка SSL игнора если включено
    if (ignoreSsl) {
        console.log('IGNORE_SSL mode enabled - disabling SSL certificate verification');
        
        // Отключаем проверку SSL для всех запросов
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            callback({ cancel: false });
        });
        
        // Игнорируем ошибки SSL
        session.defaultSession.webRequest.onErrorOccurred((details, callback) => {
            console.log('SSL Error ignored:', details.url);
            callback({});
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
                            const serverUrl = process.env.SERVER_URL || 'http://localhost:8080';
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
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('get-user-uuid', () => {
    return userUuid;
});

ipcMain.handle('show-message-box', async (event, options) => {
    return dialog.showMessageBox(mainWindow, options);
});

ipcMain.handle('show-error-dialog', async (event, title, content) => {
    return dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: title,
        message: title,
        detail: content
    });
});

// desktopCapturer обработчики
ipcMain.handle('desktop-capturer-get-sources', async (event, options) => {
    try {
        const sources = await desktopCapturer.getSources(options);
        return sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL(),
            display_id: source.display_id,
            appIcon: source.appIcon ? source.appIcon.toDataURL() : null
        }));
    } catch (error) {
        log.error('Ошибка desktopCapturer.getSources:', error);
        throw error;
    }
});

ipcMain.handle('desktop-capturer-start-stream', async (event, sourceId) => {
    try {
        // Получаем источник по ID
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        
        const source = sources.find(s => s.id === sourceId);
        if (!source) {
            throw new Error(`Источник с ID ${sourceId} не найден`);
        }
        
        // Возвращаем информацию о источнике для рендер-процесса
        return {
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL(),
            display_id: source.display_id,
            appIcon: source.appIcon ? source.appIcon.toDataURL() : null
        };
    } catch (error) {
        log.error('Ошибка desktopCapturer.startStream:', error);
        throw error;
    }
});

// Проверка обновлений
function checkForUpdates() {
    autoUpdater.checkForUpdatesAndNotify();
}

// Обработка обновлений
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

// События приложения
app.whenReady().then(async () => {
    await createWindow();

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