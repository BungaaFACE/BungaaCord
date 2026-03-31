let peerGainNodes = {}; // Хранит GainNode для каждого участника { user_uuidv4: gainNode }
let peerVolumes = {}; // Хранит громкость для каждого участника { user_uuidv4: volume }
let peerAudioElements = {}; // Хранит <audio> элементы для каждого участника { user_uuidv4: audioEl }


// Перевод громкости участника из процентов в gainNode громкость
function convertVolumeToGainNode(volume) {
    if (volume === 0) return 0;
    if (volume === 100) return 1;

    const db = (volume - 100) * 0.12;
    return Math.pow(10, db / 20);
}

// Создание GainNode для регулировки громкости участника
function createGainNodeForPeer(peerUuid, stream) {
    try {
        // 1. Инициализируем контекст
        if (!window.audioCtx) {
            window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        // 2. Если для этого пользователя еще нет GainNode, создаем цепочку
        if (!peerGainNodes[peerUuid]) {
            const gainNode = window.audioCtx.createGain();
            stream.connect(gainNode);
            gainNode.connect(window.audioCtx.destination);

            peerGainNodes[peerUuid] = gainNode;
        }
        
        targetVolume = 1;
        // Восстанавливаем сохраненную громкость для этого участника
        if (peerVolumes[peerUuid] !== undefined && peerVolumes[peerUuid] !== 100) {
            targetVolume = convertVolumeToGainNode(peerVolumes[peerUuid]);
            console.log(`✓ Восстановлена сохраненная громкость для ${peerUuid}: ${peerVolumes[peerUuid]}%`);
        }
        peerGainNodes[peerUuid].gain.setTargetAtTime(
            targetVolume, 
            window.audioCtx.currentTime, 
            0.01
        );
        
        console.log(`✓ GainNode создан для ${peerUuid}`);
    } catch (err) {
        console.error('Error creating GainNode:', err);
        console.log(`❌ Ошибка создания GainNode для ${peerUuid}: ${err.message}`);
    }
}

// Регулировка громкости участника через GainNode
function setPeerVolume(peerUuid, volume) {
    const peerGainNode = peerGainNodes[peerUuid];
    if (peerGainNode) {
        if (!isDeafened) {
            peerGainNode.gain.setTargetAtTime(
                convertVolumeToGainNode(volume), 
                window.audioCtx.currentTime, 
                0.01
            );
        }
        
        // Обновляем отображение
        const volumeValueElement = document.querySelector(`.volume-value[data-peer-uuid="${peerUuid}"]`);
        if (volumeValueElement) {
            volumeValueElement.textContent = `${volume}%`;
        }
        
        peerVolumes[peerUuid] = volume;
        // Сохраняем громкость участника
        saveSettings();
    } else {
        console.log(`⚠ GainNode не найден для ${peerUuid}`);
    }
}
