// Функции для меню выбора экрана/окна
(function() {
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
        
        // Получаем список доступных источников
        const sources = await window.electronAPI.desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        
        // Очищаем контент меню
        const menuContent = document.getElementById('screenSelectMenuContent');
        menuContent.innerHTML = '';
        
        // Группируем источники по типам
        const screens = [];
        const windows = [];
        
        sources.forEach(source => {
            // Безопасно получаем thumbnail
            let thumbnailData = null;
            try {
                if (source.thumbnail && typeof source.thumbnail.toDataURL === 'function') {
                    thumbnailData = source.thumbnail.toDataURL();
                } else {
                    // Если toDataURL недоступен, используем placeholder
                    thumbnailData = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxMDgwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIGZpbGw9IiM5OTk5OTkiLz48dGV4dCB4PSIxMjUiIHk9IjEyNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjI0IiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5TcmVhbSBUaHVtYm5haCA8L3RleHQ+PC9zdmc+';
                }
            } catch (e) {
                console.warn('Не удалось получить thumbnail для:', source.name);
                thumbnailData = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxMDgwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIGZpbGw9IiM5OTk5OTkiLz48dGV4dCB4PSIxMjUiIHk9IjEyNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjI0IiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5TcmVhbSBUaHVtYm5haCA8L3RleHQ+PC9zdmc+';
            }
            
            // Безопасно получаем appIcon
            let appIconData = null;
            try {
                if (source.appIcon && typeof source.appIcon.toDataURL === 'function') {
                    appIconData = source.appIcon.toDataURL();
                }
            } catch (e) {
                console.warn('Не удалось получить appIcon для:', source.name);
            }
            
            const sourceInfo = {
                id: source.id,
                name: source.name,
                thumbnail: thumbnailData,
                display_id: source.display_id,
                appIcon: appIconData,
                type: source.display_id !== undefined ? 'screen' : 'window'
            };
            
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
    const thumbnailSrc = source.thumbnail || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxMDgwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIGZpbGw9IiM5OTk5OTkiLz48dGV4dCB4PSIxMjUiIHk9IjEyNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjI0IiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5TcmVhbSBUaHVtYm5haCA8L3RleHQ+PC9zdmc+';
    
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