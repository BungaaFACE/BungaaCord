// Функция для проверки, запущено ли приложение через Electron
function isElectronEnvironment() {
    return !!(window.electronAPI && window.electronAPI.desktopCapturer);
}

// Функция для запуска захвата экрана через Electron
async function startElectronScreenStream() {
    console.log('🖥️ Запрос на захват экрана через Electron desktopCapturer...');
    
    try {
        // Получаем доступные источники экрана
        const sources = await window.electronAPI.desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        
        console.log(`✓ Найдено ${sources.length} источников экрана`);
        
        // Фильтруем источники, оставляя только экраны
        const screenSources = sources.filter(source =>
            source.name.includes('Экран') ||
            source.name.includes('Screen') ||
            source.name.includes('Desktop') ||
            source.display_id !== undefined
        );
        
        if (screenSources.length === 0) {
            throw new Error('Не найдено источников экрана');
        }
        
        // Выбираем первый экран
        const selectedSource = screenSources[0];
        console.log(`Выбран экран: ${selectedSource.name}`);
        
        // Создаем поток через MediaDevices.getUserMedia с указанием источника
        const constraints = {
            audio: false, // Отключаем аудио для экрана
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: selectedSource.id,
                    minWidth: 1280,
                    maxWidth: 1920,
                    minHeight: 720,
                    maxHeight: 1080,
                    minFrameRate: 30,
                    maxFrameRate: 60
                }
            }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('✓ Демонстрация экрана через Electron запущена');
        console.log(`📹 Поток содержит ${stream.getTracks().length} треков`);
        
        stream.getTracks().forEach(track => {
            console.log(`🎵 Трек: ${track.kind} (${track.label})`);
        });
        
        return stream;
        
    } catch (error) {
        console.error('❌ Ошибка захвата экрана через Electron:', error);
        throw error;
    }
}

// Функция для запуска демонстрации экрана с выбором источника
async function startElectronScreenStreamWithSelection() {
    console.log('🖥️ Запрос на захват экрана с выбором источника...');
    
    try {
        // Инициализируем меню выбора экрана, если еще не инициализировано
        if (!window.screenSelectMenuInitialized) {
            // Загружаем CSS стили
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = '/static/css/screen-select-menu.css';
            document.head.appendChild(cssLink);
            
            // Загружаем JavaScript функции
            const script = document.createElement('script');
            script.src = '/static/js/screen-select-menu.js';
            script.onload = () => {
                // Инициализируем меню после загрузки скрипта
                if (typeof initializeScreenSelectMenu === 'function') {
                    initializeScreenSelectMenu();
                    window.screenSelectMenuInitialized = true;
                }
            };
            document.head.appendChild(script);
        } else {
            // Если меню уже инициализировано, просто показываем его
            if (typeof showScreenSelectMenu === 'function') {
                showScreenSelectMenu();
            }
        }
        
        // Ждем выбора источника
        return new Promise((resolve, reject) => {
            const checkSelection = setInterval(() => {
                const selectedSource = getSelectedScreenSource();
                if (selectedSource) {
                    clearInterval(checkSelection);
                    
                    // Создаем поток с выбранным источником
                    const constraints = {
                        audio: false, // Отключаем аудио для экрана
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: selectedSource.id,
                                minWidth: 1280,
                                maxWidth: 1920,
                                minHeight: 720,
                                maxHeight: 1080,
                                minFrameRate: 30,
                                maxFrameRate: 60
                            }
                        }
                    };
                    
                    navigator.mediaDevices.getUserMedia(constraints)
                        .then(stream => {
                            console.log(`✓ Демонстрация экрана ${selectedSource.name} через Electron запущена`);
                            console.log(`📹 Поток содержит ${stream.getTracks().length} треков`);
                            resolve(stream);
                        })
                        .catch(error => {
                            console.error('❌ Ошибка создания потока:', error);
                            reject(error);
                        });
                }
            }, 100);
            
            // Таймаут через 30 секунд
            setTimeout(() => {
                clearInterval(checkSelection);
                reject(new Error('Время выбора источника истекло'));
            }, 30000);
        });
        
    } catch (error) {
        console.error('❌ Ошибка захвата экрана с выбором:', error);
        throw error;
    }
}

// Основная функция для запуска захвата экрана
async function startScreenStream() {
    console.log('🖥️ Запрос на захват экрана...');
    
    // Если запущено через Electron, используем Electron метод с выбором источника
    if (isElectronEnvironment()) {
        console.log('🔍 Обнаружена среда Electron, используется desktopCapturer с выбором источника');
        return await startElectronScreenStreamWithSelection();
    }
    
    // Иначе используем стандартный метод
    console.log('🌐 Используется стандартный метод getDisplayMedia');
    screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            mediaSource: 'screen',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
        },
        audio: true
    });
    
    console.log('✓ Демонстрация экрана запущена');
    return screenStream;
}