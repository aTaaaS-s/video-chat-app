const socket = io();
let localStream = null;
let peerConnections = {};
let iceBuffer = {}; // Буфер для ICE
let userName = null;
let usersMap = {};

// Только STUN - TURN не работают
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function log(msg) {
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  document.getElementById('log').appendChild(div);
  document.getElementById('log').scrollTop = document.getElementById('log').scrollHeight;
}

async function joinChat() {
  userName = document.getElementById('nameInput').value.trim() || 'User';
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    log('✅ Доступ получен');
    addVideo(localStream, 'local', true);
    
    document.getElementById('login').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    
    socket.emit('join', userName);
    setTimeout(testMic, 2000);
    
  } catch (err) {
    alert(err.message);
  }
}

function addVideo(stream, id, isLocal) {
  if (document.getElementById('video-' + id)) return;
  
  const name = isLocal ? userName : (usersMap[id] || id.substring(0, 6));
  log('🎬 Видео: ' + name);
  
  const wrap = document.createElement('div');
  wrap.className = 'video-wrap' + (isLocal ? ' mirror' : '');
  wrap.id = 'video-' + id;
  
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;
  
  const label = document.createElement('div');
  label.className = 'user-label';
  label.textContent = isLocal ? userName + ' (Вы)' : name;
  
  wrap.appendChild(video);
  wrap.appendChild(label);
  document.getElementById('videos').appendChild(wrap);
}

function testMic() {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  const source = ctx.createMediaStreamSource(localStream);
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  
  function check() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b) => a+b) / data.length;
    if (avg > 10) log('✅ МИКРОФОН РАБОТАЕТ!');
    setTimeout(check, 2000);
  }
  check();
}

function createPC(targetId) {
  if (peerConnections[targetId]) return peerConnections[targetId];
  
  log('🔧 PC для ' + targetId);
  iceBuffer[targetId] = []; // Инициализируем буфер
  
  const pc = new RTCPeerConnection(rtcConfig);
  
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  
  pc.ontrack = (e) => {
    log('📥 Трек от ' + targetId);
    addVideo(e.streams[0], targetId, false);
  };
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      log('❄️ ICE кандидат');
      socket.emit('ice', { to: targetId, ice: e.candidate });
    }
  };
  
  pc.oniceconnectionstatechange = () => {
    log('🔌 ICE: ' + pc.iceConnectionState);
  };
  
  peerConnections[targetId] = pc;
  return pc;
}

// ===== ПРАВИЛЬНАЯ ОБРАБОТКА ICE =====

async function handleIce(from, candidate) {
  if (!candidate) return;
  
  const pc = peerConnections[from];
  
  // Если PC нет или remote description не установлен - в буфер
  if (!pc || !pc.remoteDescription) {
    if (!iceBuffer[from]) iceBuffer[from] = [];
    iceBuffer[from].push(candidate);
    log('⏳ ICE в буфере (всего: ' + iceBuffer[from].length + ')');
    return;
  }
  
  // Можно добавлять
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    log('✅ ICE добавлен');
  } catch(e) {
    log('⚠️ ICE ошибка: ' + e.message);
  }
}

async function processIceBuffer(peerId) {
  const candidates = iceBuffer[peerId] || [];
  if (candidates.length === 0) return;
  
  log('📋 Обработка ' + candidates.length + ' ICE из буфера');
  
  const pc = peerConnections[peerId];
  if (!pc || !pc.remoteDescription) {
    log('⚠️ PC или remote description ещё не готовы');
    return;
  }
  
  for (const c of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch(e) {}
  }
  
  iceBuffer[peerId] = [];
  log('✅ Буфер очищен');
}

// ===== СОБЫТИЯ =====

socket.on('usersList', (users) => {
  log('👥 В чате: ' + users.length);
  users.forEach(u => {
    usersMap[u.id] = u.name;
    createPC(u.id);
  });
});

socket.on('userJoined', async ({id, name}) => {
  log('👤 ' + name + ' вошёл');
  if (id === socket.id) return;
  
  usersMap[id] = name;
  const pc = createPC(id);
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  log('📤 Offer создан');
  
  // Ждём 1 секунду для сбора ICE
  setTimeout(() => {
    socket.emit('offer', { to: id, offer: pc.localDescription });
    log('📤 Offer отправлен');
  }, 1000);
});

socket.on('offer', async ({from, offer}) => {
  log('📥 Offer от ' + from);
  
  const pc = createPC(from);
  
  // СНАЧАЛА remote description
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  log('✅ Remote description установлен');
  
  // ТЕПЕРЬ обрабатываем буфер
  await processIceBuffer(from);
  
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  log('📤 Answer создан');
  
  setTimeout(() => {
    socket.emit('answer', { to: from, answer: pc.localDescription });
    log('📤 Answer отправлен');
  }, 1000);
});

socket.on('answer', async ({from, answer}) => {
  log('📥 Answer от ' + from);
  
  const pc = peerConnections[from];
  if (pc) {
    // СНАЧАЛА remote description
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    log('✅ Remote description установлен');
    
    // ТЕПЕРЬ буфер
    await processIceBuffer(from);
  }
});

socket.on('ice', ({from, ice}) => {
  handleIce(from, ice);
});

socket.on('userLeft', ({id}) => {
  log('👤 Выход ' + id);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  delete iceBuffer[id];
  delete usersMap[id];
  document.getElementById('video-' + id)?.remove();
});

socket.on('count', (n) => {
  document.getElementById('count').textContent = n;
});

function toggleMic() {
  const t = localStream?.getAudioTracks()[0];
  if (t) {
    t.enabled = !t.enabled;
    document.getElementById('btnMic').textContent = t.enabled ? '🎤 ВКЛ' : '🔇 ВЫКЛ';
  }
}

function toggleCam() {
  const t = localStream?.getVideoTracks()[0];
  if (t) {
    t.enabled = !t.enabled;
    document.getElementById('btnCam').textContent = t.enabled ? '📷 ВКЛ' : '📵 ВЫКЛ';
  }
}

function copyLink() {
  navigator.clipboard.writeText(window.location.origin).then(() => {
    alert('Ссылка: ' + window.location.origin);
  });
}
