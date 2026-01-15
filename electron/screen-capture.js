// Функция для запуска захвата экрана через Electron desktopCapturer
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

// Экспортируем функцию
module.exports = {
    startElectronScreenStream
};