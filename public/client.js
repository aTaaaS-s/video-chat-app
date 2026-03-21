const socket = io();
let localStream = null;
let peerConnections = {};
let micEnabled = true;
let camEnabled = true;
const roomId = 'MAIN-ROOM';
let userName = null;
let mySocketId = null;

// TURN и STUN сервера (обязательно для работы через интернет!)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Бесплатные TURN сервера
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

function log(msg, type = 'info') {
  const debug = document.getElementById('debug');
  const div = document.createElement('div');
  const icons = {
    'info': 'ℹ️',
    'success': '✅',
    'error': '❌',
    'warning': '⚠️',
    'socket': '📡',
    'webrtc': '🔌'
  };
  div.textContent = `[${new Date().toLocaleTimeString()}] ${icons[type] || ''} ${msg}`;
  debug.appendChild(div);
  debug.scrollTop = debug.scrollHeight;
  console.log(msg);
}

function setStatus(msg, type = '') {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = type;
}

function addVideo(stream, id, isLocal) {
  const container = document.getElementById('videosContainer');
  
  if (document.getElementById(`video-${id}`)) {
    log(`Видео ${id} уже есть`, 'warning');
    return;
  }
  
  log(`🎬 Добавляю видео: ${isLocal ? 'ваше' : id}`, 'webrtc');
  
  const wrapper = document.createElement('div');
  wrapper.className = `video-wrapper ${isLocal ? 'mirror' : ''}`;
  wrapper.id = `video-${id}`;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal; // Своё видео без звука

  const nameTag = document.createElement('div');
  nameTag.className = 'user-name';
  nameTag.textContent = isLocal ? `${userName} (Вы)` : id.substring(0, 6);

  wrapper.appendChild(video);
  wrapper.appendChild(nameTag);
  container.appendChild(wrapper);
  
  // Проверяем треки
  setTimeout(() => {
    const tracks = stream.getTracks();
    log(`📹 Видео ${id}: ${tracks.length} треков`, 'webrtc');
    tracks.forEach(t => log(`  - ${t.kind}: ${t.enabled ? 'вкл' : 'выкл'}`, 'webrtc'));
  }, 1000);
}

async function startVideo() {
  userName = document.getElementById('userName').value.trim() || 'User' + Math.floor(Math.random() * 1000);
  
  log('🚀 Запуск видеочата...', 'info');
  setStatus('Запрос доступа к камере...', 'warning');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    log('✅ Доступ получен!', 'success');
    log(`🎤 Аудио треков: ${localStream.getAudioTracks().length}`, 'info');
    log(`📹 Видео треков: ${localStream.getVideoTracks().length}`, 'info');

    // Проверяем микрофон
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      log(`🎤 Микрофон: ${audioTrack.label || 'OK'}`, 'info');
      log(`🎤 Sample rate: ${settings.sampleRate || 'N/A'} Hz`, 'info');
    }

    addVideo(localStream, userName, true);
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('videoContainer').classList.remove('hidden');
    setStatus('✅ Подключено к серверу', 'success');

    // Подключаемся к комнате
    socket.emit('join-room', { roomId, userName });
    
    // Тест микрофона через 2 секунды
    setTimeout(testMicrophone, 2000);

  } catch (err) {
    log(`❌ Ошибка доступа: ${err.message}`, 'error');
    setStatus(`Ошибка: ${err.message}`, 'error');
    alert('Не удалось получить доступ:\n' + err.message);
  }
}

function createPeerConnection(targetId) {
  if (peerConnections[targetId]) {
    log(`PC для ${targetId} уже существует`, 'warning');
    return peerConnections[targetId];
  }
  
  log(`🔧 Создаю PeerConnection для ${targetId}`, 'webrtc');
  
  const pc = new RTCPeerConnection(rtcConfig);

  // Добавляем свои треки
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    log(`  Добавлен трек: ${track.kind}`, 'webrtc');
  });

  // Когда получаем удалённый поток
  pc.ontrack = (event) => {
    log(`📥 Получен ${event.track.kind} трек от ${targetId}`, 'webrtc');
    const stream = event.streams[0];
    addVideo(stream, targetId, false);
  };

  // ICE кандидаты
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log(`❄️ ICE кандидат для ${targetId}`, 'webrtc');
      socket.emit('ice-candidate', {
        targetId,
        candidate: event.candidate
      });
    }
  };

  // Состояние соединения
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`🔌 ICE: ${state} (${targetId.substring(0, 6)})`, 'webrtc');
    
    if (state === 'connected' || state === 'completed') {
      setStatus('✅ Соединение установлено!', 'success');
    } else if (state === 'failed') {
      log(`❌ ICE failed для ${targetId}`, 'error');
      setStatus('⚠️ Ошибка соединения', 'warning');
    }
  };

  pc.onconnectionstatechange = () => {
    log(`📡 Connection: ${pc.connectionState}`, 'webrtc');
  };

  pc.onnegotiationneeded = async () => {
    log(`🔄 Negotiation needed`, 'webrtc');
  };

  peerConnections[targetId] = pc;
  log(`✅ PeerConnection создан`, 'webrtc');
  return pc;
}

// ===== SOCKET.IO СОБЫТИЯ =====

socket.on('connect', () => {
  mySocketId = socket.id;
  log(`🔌 Подключён к серверу. ID: ${mySocketId}`, 'socket');
});

socket.on('user-joined', async ({ id, name }) => {
  log(`👤 ${name} (${id.substring(0, 6)}) присоединился`, 'socket');
  document.getElementById('userCount').textContent = 
    parseInt(document.getElementById('userCount').textContent) + 1;
  
  // Создаём предложение (offer)
  const pc = createPeerConnection(id);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log(`📤 Created offer для ${id.substring(0, 6)}`, 'webrtc');

    // Ждём немного для сбора ICE кандидатов
    setTimeout(() => {
      log(`📤 Отправляю offer`, 'socket');
      socket.emit('offer', { 
        targetId: id, 
        offer: pc.localDescription 
      });
    }, 500);

  } catch (err) {
    log(`❌ Ошибка создания offer: ${err.message}`, 'error');
  }
});

socket.on('offer', async ({ senderId, offer }) => {
  log(`📥 Offer от ${senderId.substring(0, 6)}`, 'socket');
  
  const pc = createPeerConnection(senderId);

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`✅ Remote description (offer) установлен`, 'webrtc');
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log(`📤 Created answer`, 'webrtc');

    setTimeout(() => {
      log(`📤 Отправляю answer`, 'socket');
      socket.emit('answer', { 
        targetId: senderId, 
        answer: pc.localDescription 
      });
    }, 500);

  } catch (err) {
    log(`❌ Ошибка offer: ${err.message}`, 'error');
  }
});

socket.on('answer', async ({ senderId, answer }) => {
  log(`📥 Answer от ${senderId.substring(0, 6)}`, 'socket');
  
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      log(`✅ Remote description (answer) установлен`, 'webrtc');
    } catch (err) {
      log(`❌ Ошибка answer: ${err.message}`, 'error');
    }
  }
});

socket.on('ice-candidate', async ({ senderId, candidate }) => {
  if (!candidate) return;
  
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      log(`✅ ICE кандидат добавлен`, 'webrtc');
    } catch (err) {
      log(`⚠️ ICE ошибка: ${err.message}`, 'warning');
    }
  }
});

socket.on('user-left', ({ id }) => {
  log(`👤 ${id.substring(0, 6)} вышел`, 'socket');
  document.getElementById('userCount').textContent = 
    Math.max(1, parseInt(document.getElementById('userCount').textContent) - 1);
  
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  const videoEl = document.getElementById(`video-${id}`);
  if (videoEl) videoEl.remove();
});

socket.on('room-users', (users) => {
  log(`👥 В комнате ${users.length} других пользователей`, 'socket');
  document.getElementById('userCount').textContent = users.length + 1;
  
  users.forEach(({ id, name }) => {
    log(`  - ${name} (${id.substring(0, 6)})`, 'socket');
    createPeerConnection(id);
  });
});

// ===== УПРАВЛЕНИЕ =====

function toggleMic() {
  const track = localStream?.getAudioTracks()[0];
  const btn = document.getElementById('btnMic');
  
  if (track) {
    micEnabled = !micEnabled;
    track.enabled = micEnabled;
    btn.textContent = micEnabled ? '🎤 Микрофон ВКЛ' : '🔇 ВЫКЛ';
    btn.className = `btn-control ${micEnabled ? 'success' : 'active'}`;
    log(micEnabled ? '🎤 Микрофон включён' : '🔇 Микрофон выключен', 'info');
  }
}

function toggleCam() {
  const track = localStream?.getVideoTracks()[0];
  const btn = document.getElementById('btnCam');
  
  if (track) {
    camEnabled = !camEnabled;
    track.enabled = camEnabled;
    btn.textContent = camEnabled ? '📷 Камера ВКЛ' : '📵 ВЫКЛ';
    btn.className = `btn-control ${camEnabled ? 'success' : 'active'}`;
    log(camEnabled ? '📷 Камера включена' : '📵 Камера выключена', 'info');
  }
}

function testMicrophone() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (!audioTrack) {
    log('❌ Аудио трек не найден!', 'error');
    return;
  }
  
  if (!audioTrack.enabled) {
    log('⚠️ Аудио трек выключен', 'warning');
    return;
  }

  try {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(localStream);
    source.connect(analyser);
    analyser.fftSize = 256;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    log('🎤 Тест микрофона запущен...', 'info');
    
    let checks = 0;
    function check() {
      if (!micEnabled) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a,b) => a+b) / dataArray.length;
      const peak = Math.max(...dataArray);
      
      checks++;
      if (checks <= 5) {
        log(`  Уровень #${checks}: ${Math.round(average)} (пик: ${peak})`, 'info');
        
        if (average > 10) {
          log('✅ МИКРОФОН РАБОТАЕТ!', 'success');
          setStatus('✅ Всё работает! Говорите...', 'success');
        }
      }
      
      if (checks < 5 && micEnabled) {
        setTimeout(check, 1000);
      } else if (checks >= 5 && average < 10) {
        log('⚠️ Звук очень тихий или микрофон не работает', 'warning');
        setStatus('⚠️ Микрофон не улавливает звук', 'warning');
      }
    }
    
    check();
    
  } catch (err) {
    log(`Ошибка теста: ${err.message}`, 'error');
  }
}

function copyLink() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ Ссылка скопирована!\n\n' + url + '\n\nОтправьте другу!');
  });
}

function stopVideo() {
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  location.reload();
}
