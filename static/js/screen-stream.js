// Основная функция для запуска захвата экрана
async function startScreenStream() {
    console.log('🖥️ Запрос на захват экрана... (browser)');
    
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