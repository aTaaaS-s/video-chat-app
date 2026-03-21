const socket = io();
let localStream = null;
let peerConnections = {};
let iceCandidatesBuffer = {}; // Буфер для ICE кандидатов
let micEnabled = true;
let camEnabled = true;
const roomId = 'MAIN-ROOM';
let userName = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
    log(`Видео ${id} уже есть`);
    return;
  }
  
  log(`🎬 Добавляю видео: ${isLocal ? 'ваше' : id}`);
  
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
  nameTag.textContent = isLocal ? `${userName} (Вы)` : id.substring(0, 6);

  wrapper.appendChild(video);
  wrapper.appendChild(nameTag);
  container.appendChild(wrapper);
  
  log(`✅ Видео добавлено`, 'success');
}

async function startVideo() {
  userName = document.getElementById('userName').value.trim() || 'User' + Math.floor(Math.random() * 1000);
  
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

    log('✅ Доступ получен!', 'success');
    log(`Аудио треков: ${localStream.getAudioTracks().length}`);
    log(`Видео треков: ${localStream.getVideoTracks().length}`);

    addVideo(localStream, userName, true);
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('videoContainer').classList.remove('hidden');
    setStatus('✅ Подключено', 'success');

    socket.emit('join-room', { roomId, userName });
    setTimeout(testMicrophone, 2000);

  } catch (err) {
    log(`❌ Ошибка: ${err.message}`, 'error');
    setStatus(err.message, 'error');
    alert(err.message);
  }
}

function createPeerConnection(targetId) {
  if (peerConnections[targetId]) {
    return peerConnections[targetId];
  }
  
  log(`🔧 Создаю PC для ${targetId}`);
  
  // Инициализируем буфер
  iceCandidatesBuffer[targetId] = [];
  
  const pc = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    log(`📥 Получен ${event.track.kind} от ${targetId}`);
    addVideo(event.streams[0], targetId, false);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log(`❄️ ICE кандидат для ${targetId}`);
      socket.emit('ice-candidate', {
        targetId,
        candidate: event.candidate
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`🔌 ICE: ${state} (${targetId.substring(0, 6)})`);
    
    if (state === 'connected' || state === 'completed') {
      setStatus('✅ Соединение установлено!', 'success');
    } else if (state === 'failed') {
      log(`❌ ICE failed`, 'error');
    }
  };

  peerConnections[targetId] = pc;
  return pc;
}

// ===== ОБРАБОТКА ICE КАНДИДАТОВ С БУФЕРОМ =====

async function addIceCandidateWithBuffer(peerId, candidate) {
  const pc = peerConnections[peerId];
  
  if (!pc) {
    // PC ещё не создан - сохраняем в буфер
    if (!iceCandidatesBuffer[peerId]) {
      iceCandidatesBuffer[peerId] = [];
    }
    iceCandidatesBuffer[peerId].push(candidate);
    log(`⏳ PC не создан, ICE в буфере (всего: ${iceCandidatesBuffer[peerId].length})`);
    return;
  }
  
  // Проверяем установлен ли remote description
  if (!pc.remoteDescription) {
    // Remote description ещё не установлен - в буфер
    if (!iceCandidatesBuffer[peerId]) {
      iceCandidatesBuffer[peerId] = [];
    }
    iceCandidatesBuffer[peerId].push(candidate);
    log(`⏳ Remote desc не установлен, ICE в буфере (всего: ${iceCandidatesBuffer[peerId].length})`);
    return;
  }
  
  // Можно добавлять
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    log(`✅ ICE добавлен`);
  } catch (err) {
    log(`⚠️ ICE ошибка: ${err.message}`);
  }
}

async function processBufferedIceCandidates(peerId) {
  const candidates = iceCandidatesBuffer[peerId] || [];
  
  if (candidates.length === 0) {
    return;
  }
  
  log(`📋 Обрабатываю ${candidates.length} ICE из буфера`);
  
  for (const candidate of candidates) {
    const pc = peerConnections[peerId];
    if (pc && pc.remoteDescription && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log(`✅ ICE из буфера добавлен`);
      } catch (err) {
        log(`⚠️ ICE из буфера ошибка: ${err.message}`);
      }
    }
  }
  
  // Очищаем буфер
  iceCandidatesBuffer[peerId] = [];
  log(`✅ Буфер очищен`);
}

// ===== СОБЫТИЯ =====

socket.on('user-joined', async ({ id, name }) => {
  log(`👤 ${name} (${id.substring(0, 6)}) вошёл`);
  document.getElementById('userCount').textContent = 
    parseInt(document.getElementById('userCount').textContent) + 1;
  
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
    log(`❌ Offer ошибка: ${err.message}`, 'error');
  }
});

socket.on('offer', async ({ senderId, offer }) => {
  log(`📥 Offer от ${senderId.substring(0, 6)}`);
  
  const pc = createPeerConnection(senderId);

  try {
    // СНАЧАЛА устанавливаем remote description
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`✅ Remote description (offer) установлен`);
    
    // ТЕПЕРЬ обрабатываем buffered ICE
    await processBufferedIceCandidates(senderId);
    
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
    log(`❌ Offer ошибка: ${err.message}`, 'error');
  }
});

socket.on('answer', async ({ senderId, answer }) => {
  log(`📥 Answer от ${senderId.substring(0, 6)}`);
  
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      // СНАЧАЛА remote description
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      log(`✅ Remote description (answer) установлен`);
      
      // ТЕПЕРЬ buffered ICE
      await processBufferedIceCandidates(senderId);
      
    } catch (err) {
      log(`❌ Answer ошибка: ${err.message}`, 'error');
    }
  }
});

socket.on('ice-candidate', ({ senderId, candidate }) => {
  log(`❄️ ICE от ${senderId.substring(0, 6)}`);
  addIceCandidateWithBuffer(senderId, candidate);
});

socket.on('user-left', ({ id }) => {
  log(`👤 ${id.substring(0, 6)} вышел`);
  document.getElementById('userCount').textContent = 
    Math.max(1, parseInt(document.getElementById('userCount').textContent) - 1);
  
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  if (iceCandidatesBuffer[id]) {
    delete iceCandidatesBuffer[id];
  }
  const videoEl = document.getElementById(`video-${id}`);
  if (videoEl) videoEl.remove();
});

socket.on('room-users', (users) => {
  log(`👥 В комнате ${users.length} других`);
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
  if (!audioTrack || !audioTrack.enabled) return;

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
    checks++;
    if (checks <= 3) {
      log(`🎤 Уровень #${checks}: ${Math.round(average)}`);
      if (average > 10) log('✅ МИКРОФОН РАБОТАЕТ!', 'success');
    }
    setTimeout(check, 2000);
  }
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
  iceCandidatesBuffer = {};
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  location.reload();
}
