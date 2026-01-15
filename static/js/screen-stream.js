async function startScreenStream() {
    console.log('🖥️ Запрос на захват экрана...');
    
    // Запрашиваем доступ к экрану с аудио
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
    return screenStream
}