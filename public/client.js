const socket = io();
let localStream = null;
let peerConnections = {};
let pendingCandidates = {}; // Буфер для ВСЕХ кандидатов
let micEnabled = true;
let camEnabled = true;
const roomId = 'MAIN-ROOM';
let userName = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function log(msg) {
  const debug = document.getElementById('debug');
  const div = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${msg}`;
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
    log(`Видео ${id} уже есть`);
    return;
  }
  
  const wrapper = document.createElement('div');
  wrapper.className = `video-wrapper ${isLocal ? 'mirror' : ''}`;
  wrapper.id = `video-${id}`;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;

  const nameTag = document.createElement('div');
  nameTag.className = 'user-name';
  nameTag.textContent = isLocal ? `${userName} (Вы)` : id.substring(0, 8);

  wrapper.appendChild(video);
  wrapper.appendChild(nameTag);
  container.appendChild(wrapper);
  
  log(`✅ Видео добавлено: ${isLocal ? 'ваше' : id.substring(0, 8)}`);
  
  // Проверяем есть ли звук
  video.onloadedmetadata = () => {
    log(`📹 Видео ${id.substring(0, 8)} загружено: ${video.videoWidth}x${video.videoHeight}`);
  };
}

async function startVideo() {
  userName = document.getElementById('userName').value.trim() || 'Аноним';
  
  log('🚀 Запуск...');
  setStatus('Запрос доступа...', 'warning');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    log('✅ Доступ получен!');
    log(`🎤 Аудио: ${localStream.getAudioTracks().length} трек(ов)`);
    log(`📹 Видео: ${localStream.getVideoTracks().length} трек(ов)`);

    // Проверяем треки
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      log(`🎤 Микрофон: ${audioTrack.label || 'OK'}`);
      log(`🎤 Включён: ${audioTrack.enabled}`);
    }

    addVideo(localStream, userName, true);
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('videoContainer').classList.remove('hidden');
    setStatus('✅ Подключено', 'success');

    socket.emit('join-room', { roomId, userName });
    
    // Тест микрофона
    setTimeout(testMicrophone, 1000);

  } catch (err) {
    log(`❌ Ошибка: ${err.message}`);
    setStatus(`Ошибка: ${err.message}`, 'error');
    alert(err.message);
  }
}

function createPeerConnection(targetId) {
  if (peerConnections[targetId]) {
    return peerConnections[targetId];
  }
  
  log(`🔧 Создаю PC для ${targetId.substring(0, 8)}`);
  
  // Инициализируем буфер
  pendingCandidates[targetId] = [];
  
  const pc = new RTCPeerConnection(rtcConfig);

  // Добавляем треки
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  // Получение удалённого трека
  pc.ontrack = (event) => {
    log(`📹 Получен ${event.track.kind} от ${targetId.substring(0, 8)}`);
    const stream = event.streams[0];
    
    // Проверяем треки
    log(`🎤 Audio tracks в потоке: ${stream.getAudioTracks().length}`);
    log(`📹 Video tracks в потоке: ${stream.getVideoTracks().length}`);
    
    addVideo(stream, targetId, false);
  };

  // ICE кандидаты
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log(`❄️ ICE кандидат для ${targetId.substring(0, 8)}`);
      socket.emit('ice-candidate', {
        targetId,
        candidate: event.candidate
      });
    }
  };

  // Состояние ICE
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`🔌 ICE: ${state} (${targetId.substring(0, 8)})`);
    
    if (state === 'connected' || state === 'completed') {
      setStatus('✅ Соединение установлено!', 'success');
    } else if (state === 'failed') {
      log(`❌ ICE failed для ${targetId.substring(0, 8)}`);
      setStatus('⚠️ Ошибка соединения', 'warning');
    }
  };

  pc.onconnectionstatechange = () => {
    log(`📡 Connection: ${pc.connectionState}`);
  };

  peerConnections[targetId] = pc;
  log(`✅ PC создан для ${targetId.substring(0, 8)}`);
  return pc;
}

// ===== СОБЫТИЯ =====

socket.on('user-joined', async ({ id, name }) => {
  log(`👤 ${name} (${id.substring(0, 8)}) вошёл`);
  
  const pc = createPeerConnection(id);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log(`📤 Offer создан`);

    // Ждём 1 секунду для сбора ICE
    setTimeout(() => {
      log(`📤 Отправляю offer`);
      socket.emit('offer', { 
        targetId: id, 
        offer: pc.localDescription 
      });
    }, 1000);

  } catch (err) {
    log(`❌ Ошибка offer: ${err.message}`);
  }
});

socket.on('offer', async ({ senderId, offer }) => {
  log(`📥 Offer от ${senderId.substring(0, 8)}`);
  
  const pc = createPeerConnection(senderId);

  try {
    // СНАЧАЛА устанавливаем remote description
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`✅ Remote description (offer) установлен`);
    
    // ТЕПЕРЬ обрабатываем buffered кандидаты
    await processBufferedCandidates(senderId);
    
    // Создаём answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log(`📤 Answer создан`);

    setTimeout(() => {
      log(`📤 Отправляю answer`);
      socket.emit('answer', { 
        targetId: senderId, 
        answer: pc.localDescription 
      });
    }, 1000);

  } catch (err) {
    log(`❌ Ошибка offer: ${err.message}`);
  }
});

socket.on('answer', async ({ senderId, answer }) => {
  log(`📥 Answer от ${senderId.substring(0, 8)}`);
  
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      // СНАЧАЛА remote description
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      log(`✅ Remote description (answer) установлен`);
      
      // ТЕПЕРЬ buffered кандидаты
      await processBufferedCandidates(senderId);
      
    } catch (err) {
      log(`❌ Ошибка answer: ${err.message}`);
    }
  }
});

socket.on('ice-candidate', ({ senderId, candidate }) => {
  log(`❄️ ICE от ${senderId.substring(0, 8)}`);
  
  const pc = peerConnections[senderId];
  
  if (!pc) {
    // PC ещё не создан - сохраняем в буфер
    if (!pendingCandidates[senderId]) {
      pendingCandidates[senderId] = [];
    }
    pendingCandidates[senderId].push(candidate);
    log(`⏳ PC не создан, сохраняю в буфер (всего: ${pendingCandidates[senderId].length})`);
    return;
  }
  
  // Проверяем установлен ли remote description
  if (!pc.remoteDescription) {
    // Remote description ещё не установлен - в буфер
    if (!pendingCandidates[senderId]) {
      pendingCandidates[senderId] = [];
    }
    pendingCandidates[senderId].push(candidate);
    log(`⏳ Remote desc не установлен, в буфер (всего: ${pendingCandidates[senderId].length})`);
    return;
  }
  
  // Можно добавлять
  addIceCandidateSafe(senderId, candidate);
});

async function processBufferedCandidates(peerId) {
  const candidates = pendingCandidates[peerId] || [];
  
  if (candidates.length === 0) {
    return;
  }
  
  log(`📋 Обрабатываю ${candidates.length} кандидатов из буфера`);
  
  for (const candidate of candidates) {
    await addIceCandidateSafe(peerId, candidate);
  }
  
  // Очищаем буфер
  pendingCandidates[peerId] = [];
  log(`✅ Буфер очищен`);
}

async function addIceCandidateSafe(peerId, candidate) {
  const pc = peerConnections[peerId];
  
  if (!pc || !candidate) {
    return;
  }
  
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    log(`✅ ICE добавлен`);
  } catch (err) {
    log(`⚠️ ICE ошибка: ${err.message}`);
  }
}

socket.on('user-left', ({ id }) => {
  log(`👤 ${id.substring(0, 8)} вышел`);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  if (pendingCandidates[id]) {
    delete pendingCandidates[id];
  }
  const videoEl = document.getElementById(`video-${id}`);
  if (videoEl) videoEl.remove();
});

socket.on('room-users', (users) => {
  log(`👥 В комнате: ${users.length} других`);
  document.getElementById('userCount').textContent = users.length + 1;
  
  users.forEach(({ id, name }) => {
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
    log(micEnabled ? '🎤 ВКЛ' : '🔇 ВЫКЛ');
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
    log(camEnabled ? '📷 ВКЛ' : '📵 ВЫКЛ');
  }
}

function testMicrophone() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (!audioTrack || !audioTrack.enabled) {
    log('⚠️ Микрофон выключен или отсутствует');
    return;
  }

  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(localStream);
  source.connect(analyser);
  analyser.fftSize = 256;
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  let checks = 0;
  function check() {
    if (!micEnabled) return;
    
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a,b) => a+b) / dataArray.length;
    const peak = Math.max(...dataArray);
    
    checks++;
    if (checks <= 3) {
      log(`🎤 Уровень #${checks}: ${Math.round(average)} (пик: ${peak})`);
      
      if (average > 10) {
        log('✅ МИКРОФОН РАБОТАЕТ!');
      }
    }
    
    setTimeout(check, 2000);
  }
  
  log('🎤 Тест микрофона...');
  check();
}

function copyLink() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ Ссылка:\n\n' + url);
  });
}

function stopVideo() {
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  pendingCandidates = {};
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  location.reload();
}
