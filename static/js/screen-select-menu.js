// Функции для меню выбора экрана/окна
(function() {
    // Функция для конвертации ArrayBuffer в base64 (браузерный аналог Buffer.from().toString('base64'))
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    // Функция для конвертации Buffer в base64 (браузерный аналог)
    function bufferToBase64(buffer) {
        if (typeof Buffer !== 'undefined') {
            // Если Buffer доступен (Node.js среда)
            return buffer.toString('base64');
        } else {
            // Если Buffer не доступен (браузерная среда)
            let binary = '';
            const bytes = new Uint8Array(buffer);
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return window.btoa(binary);
        }
    }
    
    // Функция для проверки, запущено ли приложение через Electron
    function isElectronEnvironment() {
        return !!(window.electronAPI && window.electronAPI.desktopCapturer);
    }

    let screenSelectMenu = null;
    let screenSelectOverlay = null;
    let selectedScreenSource = null;

// Инициализация меню выбора экрана
function initializeScreenSelectMenu() {
    // Создаем оверлей
    screenSelectOverlay = document.createElement('div');
    screenSelectOverlay.className = 'menu-overlay';
    screenSelectOverlay.id = 'screenSelectOverlay';
    
    // Создаем меню
    screenSelectMenu = document.createElement('div');
    screenSelectMenu.className = 'screen-select-menu';
    screenSelectMenu.id = 'screenSelectMenu';
    
    // Заголовок меню
    const menuHeader = document.createElement('div');
    menuHeader.className = 'menu-header';
    
    const menuTitle = document.createElement('div');
    menuTitle.className = 'menu-title';
    menuTitle.innerHTML = '🖥️ Выберите экран или окно для демонстрации';
    
    const menuClose = document.createElement('button');
    menuClose.className = 'menu-close';
    menuClose.innerHTML = '✕';
    menuClose.title = 'Закрыть';
    
    menuHeader.appendChild(menuTitle);
    menuHeader.appendChild(menuClose);
    
    // Контент меню
    const menuContent = document.createElement('div');
    menuContent.className = 'menu-content';
    menuContent.id = 'screenSelectMenuContent';
    
    // Собираем меню
    screenSelectMenu.appendChild(menuHeader);
    screenSelectMenu.appendChild(menuContent);
    
    // Добавляем элементы на страницу
    document.body.appendChild(screenSelectOverlay);
    document.body.appendChild(screenSelectMenu);
    
    // Обработчики событий
    menuClose.addEventListener('click', closeScreenSelectMenu);
    screenSelectOverlay.addEventListener('click', closeScreenSelectMenu);
    
    // Обработчик Escape
    document.addEventListener('keydown', handleScreenSelectMenuKeydown);
    
    console.log('✓ Меню выбора экрана инициализировано');
}

// Показ меню выбора экрана
async function showScreenSelectMenu() {
    if (!isElectronEnvironment()) {
        console.log('❌ Меню выбора экрана доступно только в Electron');
        return;
    }
    
    try {
        // Показываем оверлей и меню
        screenSelectOverlay.classList.add('show');
        screenSelectMenu.classList.add('show');
        
        // Показываем индикатор загрузки
        const menuContent = document.getElementById('screenSelectMenuContent');
        menuContent.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: #b9bbbe;">
                <div style="font-size: 24px; margin-bottom: 16px;">⏳</div>
                <div>Загрузка доступных экранов и окон...</div>
                <small style="display: block; margin-top: 8px; opacity: 0.7;">
                    Пожалуйста, подождите
                </small>
            </div>
        `;
        
        // Получаем список доступных источников с уменьшенным размером thumbnail
        const sources = await window.electronAPI.desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 320, height: 180 } // Уменьшаем размер для ускорения
        });
        
        // Очищаем контент меню
        menuContent.innerHTML = '';
        
        // Группируем источники по типам
        const screens = [];
        const windows = [];
        
        // Обрабатываем все источники (убираем ограничение)
        console.log(`Обработка ${sources.length} источников`);
        
        // Используем Promise.all для параллельной обработки
        const processedSources = await Promise.all(
            sources.map(async (source) => {
                // Безопасно получаем thumbnail - пробуем разные методы
                let thumbnailData = null;
                try {
                    console.log(`Обработка thumbnail для: ${source.name}`, {
                        hasThumbnail: !!source.thumbnail,
                        thumbnailType: typeof source.thumbnail,
                        thumbnail: source.thumbnail,
                        thumbnailMethods: source.thumbnail ? Object.getOwnPropertyNames(Object.getPrototypeOf(source.thumbnail)) : []
                    });
                    
                    if (!source.thumbnail) {
                        console.warn(`Отсутствует thumbnail для: ${source.name}`);
                        thumbnailData = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzk5OTk5OSIvPjx0ZXh0IHg9IjEyNSIgeT0iMTI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNyZWFtIFRodW1ibmFyPC90ZXh0Pjwvc3Zn';
                    } else if (typeof source.thumbnail === 'string' && source.thumbnail.startsWith('data:image/')) {
                        console.log(`Используем готовую data URL строку для: ${source.name}`);
                        thumbnailData = source.thumbnail;
                        console.log(`✓ Успешно использована готовая data URL для: ${source.name}`, {
                            dataLength: thumbnailData ? thumbnailData.length : 0,
                            dataType: typeof thumbnailData
                        });
                    } else if (typeof source.thumbnail.toDataURL === 'function') {
                        console.log(`Используем toDataURL() для: ${source.name}`);
                        thumbnailData = source.thumbnail.toDataURL();
                        console.log(`✓ Успешно получен thumbnail через toDataURL для: ${source.name}`, {
                            dataLength: thumbnailData ? thumbnailData.length : 0,
                            dataType: typeof thumbnailData
                        });
                    } else if (typeof source.thumbnail.toPNG === 'function') {
                        console.log(`Используем toPNG() для: ${source.name}`);
                        const pngBuffer = source.thumbnail.toPNG();
                        thumbnailData = `data:image/png;base64,${arrayBufferToBase64(pngBuffer)}`;
                        console.log(`✓ Успешно получен thumbnail через toPNG для: ${source.name}`, {
                            dataLength: thumbnailData ? thumbnailData.length : 0,
                            dataType: typeof thumbnailData
                        });
                    } else if (typeof source.thumbnail.toJPEG === 'function') {
                        console.log(`Используем toJPEG() для: ${source.name}`);
                        const jpegBuffer = source.thumbnail.toJPEG(80); // 80% качество
                        thumbnailData = `data:image/jpeg;base64,${arrayBufferToBase64(jpegBuffer)}`;
                        console.log(`✓ Успешно получен thumbnail через toJPEG для: ${source.name}`, {
                            dataLength: thumbnailData ? thumbnailData.length : 0,
                            dataType: typeof thumbnailData
                        });
                    } else if (source.thumbnail instanceof Buffer) {
                        console.log(`Используем Buffer для: ${source.name}`);
                        thumbnailData = `data:image/png;base64,${bufferToBase64(source.thumbnail)}`;
                        console.log(`✓ Успешно получен thumbnail через Buffer для: ${source.name}`, {
                            dataLength: thumbnailData ? thumbnailData.length : 0,
                            dataType: typeof thumbnailData
                        });
                    } else {
                        console.warn(`Неизвестный тип thumbnail для: ${source.name}`, source.thumbnail);
                        // Пробуем создать canvas и нарисовать thumbnail
                        try {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            if (ctx && source.thumbnail) {
                                canvas.width = 320;
                                canvas.height = 180;
                                ctx.fillStyle = '#2f3136';
                                ctx.fillRect(0, 0, canvas.width, canvas.height);
                                ctx.fillStyle = '#b9bbbe';
                                ctx.font = '14px Arial';
                                ctx.textAlign = 'center';
                                ctx.fillText(source.name, canvas.width / 2, canvas.height / 2);
                                thumbnailData = canvas.toDataURL();
                                console.log(`✓ Успешно создан thumbnail через canvas для: ${source.name}`);
                            } else {
                                thumbnailData = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzk5OTk5OSIvPjx0ZXh0IHg9IjEyNSIgeT0iMTI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNyZWFtIFRodW1ibmFyPC90ZXh0Pjwvc3Zn';
                            }
                        } catch (canvasError) {
                            console.error(`Ошибка при создании canvas thumbnail для: ${source.name}`, canvasError);
                            thumbnailData = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzk5OTk5OSIvPjx0ZXh0IHg9IjEyNSIgeT0iMTI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNyZWFtIFRodW1ibmFyPC90ZXh0Pjwvc3Zn';
                        }
                    }
                } catch (e) {
                    console.error(`Ошибка при получении thumbnail для: ${source.name}`, e);
                    thumbnailData = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzk5OTk5OSIvPjx0ZXh0IHg9IjEyNSIgeT0iMTI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNyZWFtIFRodW1ibmFyPC90ZXh0Pjwvc3Zn';
                }
                
                // Безопасно получаем appIcon
                let appIconData = null;
                try {
                    if (source.appIcon && typeof source.appIcon.toDataURL === 'function') {
                        appIconData = await Promise.resolve(source.appIcon.toDataURL());
                    }
                } catch (e) {
                    console.warn('Не удалось получить appIcon для:', source.name);
                }
                
                return {
                    id: source.id,
                    name: source.name,
                    thumbnail: thumbnailData,
                    display_id: source.display_id,
                    appIcon: appIconData,
                    type: source.display_id !== undefined ? 'screen' : 'window'
                };
            })
        );
        
        // Разделяем обработанные источники по типам (данные уже обработаны в Promise.all)
        processedSources.forEach(sourceInfo => {
            if (sourceInfo.type === 'screen') {
                screens.push(sourceInfo);
            } else {
                windows.push(sourceInfo);
            }
        });
        
        // Добавляем разделы
        if (screens.length > 0) {
            addSectionTitle(menuContent, '🖥️ Экраны');
            screens.forEach(source => addScreenItem(menuContent, source));
        }
        
        if (windows.length > 0) {
            addSectionTitle(menuContent, '🪟 Окна');
            windows.forEach(source => addScreenItem(menuContent, source));
        }
        
        if (screens.length === 0 && windows.length === 0) {
            addNoSourcesMessage(menuContent);
        }
        
        console.log(`✓ Загружено ${sources.length} источников (${screens.length} экранов, ${windows.length} окон)`);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки источников экрана:', error);
        const menuContent = document.getElementById('screenSelectMenuContent');
        menuContent.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #ed4245;">
                ❌ Ошибка загрузки источников экрана<br>
                <small style="color: #b9bbbe;">${error.message}</small>
            </div>
        `;
    }
}

// Добавление заголовка раздела
function addSectionTitle(container, title) {
    const sectionTitle = document.createElement('div');
    sectionTitle.style.cssText = `
        padding: 8px 16px;
        color: #b9bbbe;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 8px 0 4px 0;
    `;
    sectionTitle.textContent = title;
    container.appendChild(sectionTitle);
}

// Добавление элемента экрана/окна
function addScreenItem(container, source) {
    console.log(`Добавление элемента для: ${source.name}`, {
        thumbnail: source.thumbnail,
        thumbnailType: typeof source.thumbnail,
        thumbnailLength: source.thumbnail ? source.thumbnail.length : 0,
        appIcon: source.appIcon
    });
    
    const screenItem = document.createElement('div');
    screenItem.className = 'screen-item';
    screenItem.setAttribute('data-source-id', source.id);
    
    // Определяем иконку в зависимости от типа
    let icon = '🖥️';
    if (source.type === 'window') {
        // Пытаемся определить иконку приложения
        if (source.appIcon) {
            icon = `<img src="${source.appIcon}" style="width: 16px; height: 16px; border-radius: 2px;" alt="">`;
        } else {
            icon = '🪟';
        }
    }
    
    // Безопасно используем thumbnail
    const thumbnailSrc = source.thumbnail || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxMDgwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIGZpbGw9IiM5OTk5OSIvPjx0ZXh0IHg9IjEyNSIgeT0iMTI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNyZWFtIFRodW1ibmFyPC90ZXh0Pjwvc3Zn';
    
    console.log(`Используемый thumbnail для ${source.name}:`, {
        src: thumbnailSrc,
        isPlaceholder: thumbnailSrc.includes('PHN2Zy'),
        length: thumbnailSrc.length
    });
    
    screenItem.innerHTML = `
        <img src="${thumbnailSrc}" alt="${source.name}" class="screen-thumbnail">
        <div class="screen-info">
            <div class="screen-name" title="${source.name}">${source.name}</div>
            <div class="screen-type">${source.type === 'screen' ? 'Экран' : 'Окно'}</div>
        </div>
        <div class="screen-icon">${icon}</div>
    `;
    
    // Обработчик выбора
    screenItem.addEventListener('click', () => {
        selectScreenSource(source);
    });
    
    container.appendChild(screenItem);
}

// Добавление сообщения об отсутствии источников
function addNoSourcesMessage(container) {
    const noSources = document.createElement('div');
    noSources.style.cssText = `
        padding: 40px 20px;
        text-align: center;
        color: #b9bbbe;
    `;
    noSources.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">📺</div>
        <div>Не найдено доступных экранов или окон</div>
        <small style="display: block; margin-top: 8px; opacity: 0.7;">
            Убедитесь, что у вас есть открытые окна или экраны для демонстрации
        </small>
    `;
    container.appendChild(noSources);
}

// Выбор источника экрана
function selectScreenSource(source) {
    selectedScreenSource = source;
    
    // Обновляем визуальное состояние
    document.querySelectorAll('.screen-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const selectedItem = document.querySelector(`[data-source-id="${source.id}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
    
    console.log(`✅ Выбран источник: ${source.name} (${source.type})`);
    
    // Закрываем меню через небольшую задержку для визуальной обратной связи
    setTimeout(() => {
        closeScreenSelectMenu();
    }, 200);
}

// Закрытие меню выбора экрана
function closeScreenSelectMenu() {
    screenSelectOverlay.classList.remove('show');
    screenSelectMenu.classList.remove('show');
    selectedScreenSource = null;
    
    // Удаляем обработчик клавиатуры
    document.removeEventListener('keydown', handleScreenSelectMenuKeydown);
    
    console.log('✓ Меню выбора экрана закрыто');
}

// Обработчик клавиатуры для меню
function handleScreenSelectMenuKeydown(event) {
    if (event.key === 'Escape') {
        closeScreenSelectMenu();
    }
}

// Получение выбранного источника экрана
function getSelectedScreenSource() {
    return selectedScreenSource;
}

// Проверка, активно ли меню
function isScreenSelectMenuActive() {
    return screenSelectMenu && screenSelectMenu.classList.contains('show');
}

    // Экспортируем функции
    window.initializeScreenSelectMenu = initializeScreenSelectMenu;
    window.showScreenSelectMenu = showScreenSelectMenu;
    window.closeScreenSelectMenu = closeScreenSelectMenu;
    window.getSelectedScreenSource = getSelectedScreenSource;
    window.isScreenSelectMenuActive = isScreenSelectMenuActive;
})();