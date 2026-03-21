const socket = io();
let localStream = null;
let peerConnections = {};
let iceCandidateQueues = {}; // Очередь ICE кандидатов
let micEnabled = true;
let camEnabled = true;
const roomId = 'MAIN-ROOM';
let userName = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

function log(msg) {
  const debug = document.getElementById('debug');
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
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
  nameTag.textContent = isLocal ? `${userName} (Вы)` : id;

  wrapper.appendChild(video);
  wrapper.appendChild(nameTag);
  container.appendChild(wrapper);
  
  log(`✅ Видео добавлено: ${isLocal ? 'ваше' : id}`);
}

async function startVideo() {
  userName = document.getElementById('userName').value.trim() || 'Аноним';
  
  log('🚀 Запуск видеочата...');
  setStatus('Запрос доступа...', 'warning');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    log('✅ Доступ получен!');
    log(`Аудио треков: ${localStream.getAudioTracks().length}`);
    log(`Видео треков: ${localStream.getVideoTracks().length}`);

    addVideo(localStream, userName, true);
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('videoContainer').classList.remove('hidden');
    setStatus('✅ Подключено к серверу', 'success');

    socket.emit('join-room', { roomId, userName });
    setTimeout(testMicrophone, 2000);

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
  
  log(`🔧 Создание PeerConnection для ${targetId}`);
  
  // Инициализируем очередь ICE кандидатов
  iceCandidateQueues[targetId] = [];
  
  const pc = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    log(`📹 Получен ${event.track.kind} трек от ${targetId}`);
    addVideo(event.streams[0], targetId, false);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log(`❄️ Отправляю ICE кандидат для ${targetId}`);
      socket.emit('ice-candidate', {
        targetId,
        candidate: event.candidate
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    log(`🔌 ICE состояние с ${targetId}: ${pc.iceConnectionState}`);
    
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      setStatus('✅ Соединение установлено!', 'success');
    } else if (pc.iceConnectionState === 'failed') {
      log(`❌ Соединение с ${targetId} не удалось`);
      setStatus('⚠️ Проблема с соединением', 'warning');
    }
  };

  peerConnections[targetId] = pc;
  return pc;
}

// Обработка ICE кандидатов с очередью
async function processIceCandidate(senderId, candidate) {
  const pc = peerConnections[senderId];
  
  if (!pc) {
    log(`⏳ PC для ${senderId} ещё не создан, добавляю в очередь`);
    if (!iceCandidateQueues[senderId]) {
      iceCandidateQueues[senderId] = [];
    }
    iceCandidateQueues[senderId].push(candidate);
    return;
  }
  
  try {
    if (candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      log(`✅ ICE кандидат добавлен для ${senderId}`);
    }
  } catch (err) {
    log(`⚠️ Ошибка добавления ICE: ${err.message}`);
  }
}

// ===== СОБЫТИЯ =====
socket.on('connect', () => {
  log(`🔌 Подключён к серверу. ID: ${socket.id}`);
});

socket.on('user-joined', async ({ id, name }) => {
  log(`👤 ${name} (${id}) присоединился`);
  
  const pc = createPeerConnection(id);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log(`📤 Created offer для ${id}`);

    // Ждём пока соберутся ICE кандидаты
    setTimeout(() => {
      log(`📤 Отправляю offer ${id}`);
      socket.emit('offer', { 
        targetId: id, 
        offer: pc.localDescription 
      });
    }, 1000);

  } catch (err) {
    log(`❌ Ошибка создания offer: ${err.message}`);
  }
});

socket.on('offer', async ({ senderId, offer }) => {
  log(`📥 Получен offer от ${senderId}`);
  
  const pc = createPeerConnection(senderId);

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`✅ Remote description установлен (offer)`);
    
    // Обрабатываем queued ICE кандидаты
    if (iceCandidateQueues[senderId]) {
      log(`📋 Обрабатываю ${iceCandidateQueues[senderId].length} ICE кандидатов из очереди`);
      for (const candidate of iceCandidateQueues[senderId]) {
        await processIceCandidate(senderId, candidate);
      }
      iceCandidateQueues[senderId] = [];
    }
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log(`📤 Created answer для ${senderId}`);

    setTimeout(() => {
      log(`📤 Отправляю answer ${senderId}`);
      socket.emit('answer', { 
        targetId: senderId, 
        answer: pc.localDescription 
      });
    }, 1000);

  } catch (err) {
    log(`❌ Ошибка обработки offer: ${err.message}`);
  }
});

socket.on('answer', async ({ senderId, answer }) => {
  log(`📥 Получен answer от ${senderId}`);
  
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      log(`✅ Remote description установлен (answer)`);
      
      // Обрабатываем queued ICE кандидаты
      if (iceCandidateQueues[senderId]) {
        log(`📋 Обрабатываю ${iceCandidateQueues[senderId].length} ICE кандидатов из очереди`);
        for (const candidate of iceCandidateQueues[senderId]) {
          await processIceCandidate(senderId, candidate);
        }
        iceCandidateQueues[senderId] = [];
      }
      
    } catch (err) {
      log(`❌ Ошибка установки answer: ${err.message}`);
    }
  }
});

socket.on('ice-candidate', ({ senderId, candidate }) => {
  log(`❄️ Получен ICE кандидат от ${senderId}`);
  processIceCandidate(senderId, candidate);
});

socket.on('user-left', ({ id }) => {
  log(`👤 ${id} вышел`);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  if (iceCandidateQueues[id]) {
    delete iceCandidateQueues[id];
  }
  const videoEl = document.getElementById(`video-${id}`);
  if (videoEl) videoEl.remove();
});

socket.on('room-users', (users) => {
  log(`👥 В комнате ${users.length} других пользователей`);
  document.getElementById('userCount').textContent = users.length + 1;
  
  users.forEach(({ id, name }) => {
    log(`Создаю соединение с ${name} (${id})`);
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
    btn.textContent = micEnabled ? '🎤 Микрофон ВКЛ' : '🔇 Микрофон ВЫКЛ';
    btn.className = `btn-control ${micEnabled ? 'success' : 'active'}`;
    log(micEnabled ? '🎤 Микрофон включён' : '🔇 Микрофон выключен');
  }
}

function toggleCam() {
  const track = localStream?.getVideoTracks()[0];
  const btn = document.getElementById('btnCam');
  
  if (track) {
    camEnabled = !camEnabled;
    track.enabled = camEnabled;
    btn.textContent = camEnabled ? '📷 Камера ВКЛ' : '📵 Камера ВЫКЛ';
    btn.className = `btn-control ${camEnabled ? 'success' : 'active'}`;
    log(camEnabled ? '📷 Камера включена' : '📵 Камера выключена');
  }
}

function testMicrophone() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (!audioTrack || !audioTrack.enabled) return;

  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(localStream);
  source.connect(analyser);
  analyser.fftSize = 256;
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  function check() {
    if (!micEnabled) return;
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a,b) => a+b) / dataArray.length;
    if (average > 5) {
      log('✅ Микрофон работает!');
    }
    setTimeout(check, 2000);
  }
  check();
}

function copyLink() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ Ссылка скопирована!\n\n' + url);
  });
}

function stopVideo() {
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  iceCandidateQueues = {};
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  location.reload();
}
