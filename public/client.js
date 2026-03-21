const socket = io();
let localStream = null;
let peerConnections = {};
let iceBuffer = {};
let userName = null;
let usersMap = {}; // Храним имена пользователей

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:8080', username: 'openrelayproject', credential: 'openrelayproject' }
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

function addVideo(stream, id, isLocal) {
  if (document.getElementById(`video-${id}`)) {
    log(`Видео ${id} уже есть`);
    return;
  }
  
  // Получаем имя пользователя
  const displayName = isLocal ? userName : (usersMap[id] || id.substring(0, 6));
  
  log(`🎬 Видео: ${isLocal ? 'ваше' : displayName}`);
  
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
  nameTag.textContent = isLocal ? `${userName} (Вы)` : displayName;

  wrapper.appendChild(video);
  wrapper.appendChild(nameTag);
  document.getElementById('videosContainer').appendChild(wrapper);
  
  // Проверяем треки через 2 секунды
  setTimeout(() => {
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    log(`📹 ${displayName}: audio=${audioTracks.length}, video=${videoTracks.length}`);
  }, 2000);
}

async function startVideo() {
  userName = document.getElementById('userName').value.trim() || 'User' + Math.floor(Math.random() * 1000);
  
  log(`🚀 Запуск как ${userName}`);

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    
    log('✅ Доступ получен');
    addVideo(localStream, userName, true);
    
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('videoContainer').classList.remove('hidden');
    
    socket.emit('join-room', { userName });
    log('📤 join-room отправлено');
    
    setTimeout(testMic, 2000);
  } catch (err) {
    alert('Ошибка: ' + err.message);
  }
}

function createPC(targetId) {
  if (peerConnections[targetId]) {
    log(`PC для ${targetId} уже есть`);
    return peerConnections[targetId];
  }
  
  const userNameDisplay = usersMap[targetId] || targetId.substring(0, 6);
  log(`🔧 Создаю PC для ${userNameDisplay} (${targetId})`);
  
  iceBuffer[targetId] = [];
  
  const pc = new RTCPeerConnection(rtcConfig);
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  pc.ontrack = (e) => {
    log(`📥 Получен ${e.track.kind} трек от ${userNameDisplay}`);
    addVideo(e.streams[0], targetId, false);
  };
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { targetId, candidate: e.candidate });
    }
  };
  
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`🔌 ICE ${state} (${userNameDisplay})`);
    
    if (state === 'connected' || state === 'completed') {
      document.getElementById('status').textContent = '✅ Соединение установлено!';
      document.getElementById('status').className = 'success';
    } else if (state === 'disconnected' || state === 'failed') {
      document.getElementById('status').textContent = '⚠️ Проблема с соединением';
      document.getElementById('status').className = 'warning';
    }
  };
  
  pc.onconnectionstatechange = () => {
    log(`📡 Connection: ${pc.connectionState}`);
  };
  
  peerConnections[targetId] = pc;
  return pc;
}

async function addIceBuffered(peerId, candidate) {
  if (!candidate) return;
  
  const pc = peerConnections[peerId];
  
  if (!pc || !pc.remoteDescription) {
    if (!iceBuffer[peerId]) iceBuffer[peerId] = [];
    iceBuffer[peerId].push(candidate);
    return;
  }
  
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch(e) {
    log(`ICE ошибка: ${e.message}`);
  }
}

async function processBuffer(peerId) {
  const candidates = iceBuffer[peerId] || [];
  if (candidates.length === 0) return;
  
  log(`📋 Обработка ${candidates.length} ICE из буфера`);
  
  for (const c of candidates) {
    const pc = peerConnections[peerId];
    if (pc && pc.remoteDescription && c) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch(e) {}
    }
  }
  iceBuffer[peerId] = [];
}

// ===== СОБЫТИЯ =====

socket.on('room-users', (users) => {
  log(`👥 В комнате: ${users.length} других`);
  
  // Сохраняем имена
  users.forEach(u => {
    usersMap[u.id] = u.name;
    log(`  - ${u.name} (${u.id.substring(0,6)})`);
  });
  
  // Создаём соединения
  users.forEach(u => createPC(u.id));
});

socket.on('user-joined', async ({id, name}) => {
  log(`👤 ${name} (${id.substring(0,6)}) вошёл`);
  
  if (id === socket.id) {
    log('Это мы сами, пропускаем');
    return;
  }
  
  // Сохраняем имя
  usersMap[id] = name;
  
  // Обновляем счётчик
  const count = Object.keys(usersMap).length + 1;
  document.getElementById('userCount').textContent = count;
  
  const pc = createPC(id);
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log(`📤 Offer создан`);
    
    setTimeout(() => {
      socket.emit('offer', { targetId: id, offer: pc.localDescription });
      log(`📤 Offer отправлен`);
    }, 1000);
  } catch(e) { 
    log(`Offer error: ${e.message}`); 
  }
});

socket.on('offer', async ({senderId, offer}) => {
  const senderName = usersMap[senderId] || senderId.substring(0, 6);
  log(`📥 Offer от ${senderName}`);
  
  const pc = createPC(senderId);
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`✅ Remote desc установлен`);
    
    await processBuffer(senderId);
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log(`📤 Answer создан`);
    
    setTimeout(() => {
      socket.emit('answer', { targetId: senderId, answer: pc.localDescription });
      log(`📤 Answer отправлен`);
    }, 1000);
  } catch(e) { 
    log(`Answer error: ${e.message}`); 
  }
});

socket.on('answer', async ({senderId, answer}) => {
  const senderName = usersMap[senderId] || senderId.substring(0, 6);
  log(`📥 Answer от ${senderName}`);
  
  const pc = peerConnections[senderId];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    log(`✅ Remote desc (answer) установлен`);
    await processBuffer(senderId);
  }
});

socket.on('ice-candidate', ({senderId, candidate}) => {
  addIceBuffered(senderId, candidate);
});

socket.on('user-left', ({id}) => {
  const name = usersMap[id] || id.substring(0, 6);
  log(`👤 ${name} вышел`);
  
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  if (iceBuffer[id]) {
    delete iceBuffer[id];
  }
  if (usersMap[id]) {
    delete usersMap[id];
  }
  
  document.getElementById(`video-${id}`)?.remove();
  
  const count = Object.keys(usersMap).length + 1;
  document.getElementById('userCount').textContent = count;
});

socket.on('update-count', (count) => {
  document.getElementById('userCount').textContent = count;
});

// ===== УПРАВЛЕНИЕ =====

function toggleMic() {
  const track = localStream?.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('btnMic').textContent = track.enabled ? '🎤 Микрофон ВКЛ' : '🔇 ВЫКЛ';
  }
}

function toggleCam() {
  const track = localStream?.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('btnCam').textContent = track.enabled ? '📷 Камера ВКЛ' : '📵 ВЫКЛ';
  }
}

function testMic() {
  const track = localStream?.getAudioTracks()[0];
  if (!track || !track.enabled) return;
  
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  const source = ctx.createMediaStreamSource(localStream);
  source.connect(analyser);
  
  const data = new Uint8Array(analyser.frequencyBinCount);
  let checks = 0;
  
  function check() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b) => a+b) / data.length;
    checks++;
    
    if (checks <= 3) {
      log(`🎤 Уровень #${checks}: ${Math.round(avg)}`);
      if (avg > 10) log('✅ МИКРОФОН РАБОТАЕТ!');
    }
    
    setTimeout(check, 2000);
  }
  log('🎤 Тест микрофона...');
  check();
}

function copyLink() {
  navigator.clipboard.writeText(window.location.origin).then(() => {
    alert('✅ Ссылка скопирована!\n\n' + window.location.origin);
  });
}

function stopVideo() {
  location.reload();
}
