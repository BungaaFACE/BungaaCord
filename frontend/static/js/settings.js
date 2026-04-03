let selectedMicrophoneId = '';

// Инициализация модального окна настроек
function initializeSettingsModal() {
    const settingsIcon = document.getElementById('settingsIcon');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    
    // Открытие модального окна при клике на иконку настроек
    if (settingsIcon) {
        settingsIcon.addEventListener('click', async function() {
            if (settingsModal) {
                settingsModal.style.display = 'block';
                document.body.style.overflow = 'hidden'; // Блокируем прокрутку фона
                
                // При открытии настроек обновляем список микрофонов
                await updateMicrophoneList();
                
                // При открытии настроек запрашиваем доступ к микрофону, если еще не получили
                if (!localStream) {
                    await getLocalStreamWithSelectedMicrophone();
                }
            }
        });
    }
    
    // Закрытие модального окна при клике на крестик
    if (closeSettings) {
        closeSettings.addEventListener('click', function() {
            if (settingsModal) {
                settingsModal.style.display = 'none';
                document.body.style.overflow = 'auto'; // Восстанавливаем прокрутку фона
            }
        });
    }
    
    // Закрытие модального окна при клике вне его области
    if (settingsModal) {
        settingsModal.addEventListener('click', function(event) {
            if (event.target === settingsModal) {
                settingsModal.style.display = 'none';
                document.body.style.overflow = 'auto'; // Восстанавливаем прокрутку фона
            }
        });
    }
    
    // Закрытие модального окна при нажатии клавиши Escape
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && settingsModal && settingsModal.style.display === 'block') {
            settingsModal.style.display = 'none';
            document.body.style.overflow = 'auto'; // Восстанавливаем прокрутку фона
        }
    });
    
    // Обработчик изменения выбора микрофона
    microphoneSelect = document.getElementById('microphoneSelect');
    microphoneSelect.addEventListener('change', async () => {
        saveSettings();
        console.log(`🎤 Выбран микрофон: ${selectedMicrophoneId}`);
        
        // Автоматически обновляем аудиопоток при смене микрофона
        try {
            console.log('🔄 Автоматическое обновление аудиопотока...');
            const success = await updateMicrophoneStream();
            
            if (success) {
                console.log('✓ Аудиопоток успешно обновлен');
                // Показываем пользователю уведомление об успешной смене микрофона
                showNotification('Микрофон успешно изменен', 'success');
            } else {
                console.log('❌ Не удалось обновить аудиопоток');
                showNotification('Ошибка при смене микрофона', 'error');
            }
        } catch (error) {
            console.error('❌ Ошибка при обновлении аудиопотока:', error);
            showNotification('Ошибка при смене микрофона', 'error');
        }
    });
    
    // Обработчик кнопки обновления списка
    refreshMicrophonesBtn = document.getElementById('refreshMicrophonesBtn');
    refreshMicrophonesBtn.addEventListener('click', () => {
        console.log('🔄 Обновление списка микрофонов...');
        updateMicrophoneList();
    });

    // Обработчик переключателя RNNoise
    const rnnoiseToggle = document.getElementById('rnnoiseToggle');
    if (rnnoiseToggle) {
        rnnoiseToggle.checked = enableRNNoise
        rnnoiseToggle.addEventListener('change', async () => {
            if (toggleRNNoise) {
                await toggleRNNoise();
                saveSettings();
            }
        });
    }
    
    console.log('✓ Элементы управления микрофоном инициализированы');
}

// Получение списка доступных микрофонов
async function getAvailableMicrophones() {
    try {
        console.log('🔍 Поиск доступных микрофонов...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        const microphones = devices.filter(device => device.kind === 'audioinput');
        
        console.log(`✓ Найдено ${microphones.length} микрофонов:`, microphones);
        return microphones;
    } catch (error) {
        console.error('❌ Ошибка при получении списка микрофонов:', error);
        return [];
    }
}


// Обновление списка микрофонов в интерфейсе
async function updateMicrophoneList() {
    if (!microphoneSelect) return;
    
    try {
        // Показываем состояние загрузки
        microphoneSelect.innerHTML = '<option value="">Загрузка доступных микрофонов...</option>';
        
        const microphones = await getAvailableMicrophones();
        
        if (microphones.length === 0) {
            microphoneSelect.innerHTML = '<option value="">Микрофоны не найдены</option>';
            return;
        }
        
        // Очищаем список
        microphoneSelect.innerHTML = '';
        
        // Добавляем опции
        microphones.forEach(microphone => {
            const option = document.createElement('option');
            option.value = microphone.deviceId;
            
            // Улучшаем отображение названия микрофона
            let displayName = microphone.label || `Микрофон ${microphone.deviceId.substring(0, 8)}...`;
            
            // Если название содержит техническую информацию в скобках, убираем её
            if (displayName.includes('(') && displayName.includes(')')) {
                // Убираем всё в скобках в конце названия
                displayName = displayName.replace(/\s*\([^)]*\)$/, '');
            }
            
            // Если название всё ещё слишком длинное, обрезаем его
            if (displayName.length > 50) {
                displayName = displayName.substring(0, 47) + '...';
            }
            
            option.textContent = displayName;
            microphoneSelect.appendChild(option);
        });
        
        // Выбираем сохраненный микрофон или первый доступный
        if (selectedMicrophoneId && microphones.some(m => m.deviceId === selectedMicrophoneId)) {
            microphoneSelect.value = selectedMicrophoneId;
            console.log(`✓ Выбран сохраненный микрофон: ${selectedMicrophoneId}`);
        } else if (microphones.length > 0) {
            microphoneSelect.value = microphones[0].deviceId;
            selectedMicrophoneId = microphones[0].deviceId;
            saveSettings();
            console.log(`✓ Выбран первый доступный микрофон: ${microphones[0].deviceId}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка обновления списка микрофонов:', error);
        microphoneSelect.innerHTML = '<option value="">Ошибка загрузки</option>';
    }
}

