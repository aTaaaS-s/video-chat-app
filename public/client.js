// Замени функцию joinRoom на эту:
async function joinRoom() {
  userName = document.getElementById('userName').value.trim();
  roomId = document.getElementById('roomId').value.trim();

  if (!userName || !roomId) {
    alert('Введите имя и название комнаты!');
    return;
  }

  try {
    // Проверяем поддержку медиа
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Ваш браузер не поддерживает видеочаты');
    }

    // Запрашиваем доступ с явными настройками
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: { 
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Проверяем треки
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    
    console.log('🎤 Аудио трек:', audioTrack ? {
      label: audioTrack.label,
      enabled: audioTrack.enabled,
      muted: audioTrack.muted,
      settings: audioTrack.getSettings()
    } : 'НЕТ АУДИО ТРЕКА');
    
    console.log('📹 Видео трек:', videoTrack ? {
      label: videoTrack.label,
      enabled: videoTrack.enabled,
      settings: videoTrack.getSettings()
    } : 'НЕТ ВИДЕО ТРЕКА');

    // Показываем своё видео
    addVideo(localStream, userName, true);

    // Переключаем экран
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    document.getElementById('displayRoomId').textContent = roomId;

    // Сохраняем roomId в URL
    history.pushState({}, '', `?room=${roomId}`);

    // Подключаемся к комнате
    socket.emit('join-room', { roomId, userName });

    // Проверяем микрофон через 1 секунду
    setTimeout(() => {
      checkMicrophone();
    }, 1000);

  } catch (err) {
    console.error('Ошибка доступа к медиа:', err);
    let errorMsg = 'Не удалось получить доступ к камере/микрофону.\n\n';
    
    if (err.name === 'NotAllowedError') {
      errorMsg += '❌ Вы запретили доступ. Разрешите в настройках браузера.';
    } else if (err.name === 'NotFoundError') {
      errorMsg += '❌ Камера/микрофон не найдены.';
    } else if (err.name === 'NotReadableError') {
      errorMsg += '❌ Устройство уже используется другой программой.';
    } else {
      errorMsg += err.message;
    }
    
    alert(errorMsg);
  }
}

// Добавь функцию проверки микрофона
function checkMicrophone() {
  const audioTrack = localStream?.getAudioTracks()[0];
  
  if (!audioTrack) {
    console.warn('⚠️ Аудио трек отсутствует!');
    document.getElementById('btnMic').classList.add('active');
    return;
  }

  // Создаем анализатор для проверки звука
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(localStream);
  
  source.connect(analyser);
  analyser.fftSize = 256;
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  function checkLevel() {
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    
    if (average > 10) {
      console.log('🎤 Микрофон работает! Уровень:', Math.round(average));
      document.getElementById('btnMic').classList.remove('active');
    } else {
      console.log('🔇 Тишина в микрофоне (уровень:', Math.round(average) + ')');
    }
    
    if (audioTrack.enabled) {
      requestAnimationFrame(checkLevel);
    }
  }
  
  checkLevel();
}

// Замени функцию toggleMic на улучшенную:
function toggleMic() {
  const btn = document.getElementById('btnMic');
  const audioTrack = localStream?.getAudioTracks()[0];
  
  if (!audioTrack) {
    alert('⚠️ Микрофон не найден! Проверьте разрешения.');
    return;
  }
  
  audioTrack.enabled = !audioTrack.enabled;
  btn.classList.toggle('active', !audioTrack.enabled);
  
  console.log('🎤 Микрофон:', audioTrack.enabled ? 'ВКЛ' : 'ВЫКЛ');
}
