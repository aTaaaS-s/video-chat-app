const socket = io();
let localStream = null;
let peerConnections = {};
let iceBuffer = {};
let userName = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

function log(msg) {
  const debug = document.getElementById('debug');
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debug.appendChild(div);
  debug.scrollTop = debug.scrollHeight;
}

function addVideo(stream, id, isLocal) {
  if (document.getElementById(`video-${id}`)) return;
  
  log(`🎬 Видео: ${isLocal ? 'ваше' : id}`);
  
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
  document.getElementById('videosContainer').appendChild(wrapper);
}

async function startVideo() {
  userName = document.getElementById('userName').value.trim() || 'User' + Math.floor(Math.random() * 1000);
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    log('✅ Доступ получен');
    
    addVideo(localStream, userName, true);
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('videoContainer').classList.remove('hidden');
    
    // Входим в комнату
    socket.emit('join-room', { userName });
    log('📤 Отправлено join-room');
    
    setTimeout(testMic, 2000);
  } catch (err) {
    alert(err.message);
  }
}

function createPC(targetId) {
  if (peerConnections[targetId]) return peerConnections[targetId];
  
  log(`🔧 PC для ${targetId}`);
  iceBuffer[targetId] = [];
  
  const pc = new RTCPeerConnection(rtcConfig);
  
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  
  pc.ontrack = (e) => {
    log(`📥 Трек от ${targetId}`);
    addVideo(e.streams[0], targetId, false);
  };
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { targetId, candidate: e.candidate });
    }
  };
  
  pc.oniceconnectionstatechange = () => {
    log(`ICE: ${pc.iceConnectionState} (${targetId.substring(0,6)})`);
  };
  
  peerConnections[targetId] = pc;
  return pc;
}

async function addIceBuffered(peerId, candidate) {
  const pc = peerConnections[peerId];
  
  if (!pc || !pc.remoteDescription) {
    if (!iceBuffer[peerId]) iceBuffer[peerId] = [];
    iceBuffer[peerId].push(candidate);
    log(`⏳ ICE в буфере`);
    return;
  }
  
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    log(`✅ ICE добавлен`);
  } catch(e) {}
}

async function processBuffer(peerId) {
  const candidates = iceBuffer[peerId] || [];
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
  users.forEach(u => createPC(u.id));
});

socket.on('user-joined', async ({id, name}) => {
  log(`👤 ${name} (${id.substring(0,6)}) вошёл`);
  
  if (id === socket.id) return; // Это мы сами
  
  const pc = createPC(id);
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    setTimeout(() => {
      socket.emit('offer', { targetId: id, offer: pc.localDescription });
    }, 500);
  } catch(e) { log(`Offer error: ${e.message}`); }
});

socket.on('offer', async ({senderId, offer}) => {
  log(`📥 Offer от ${senderId.substring(0,6)}`);
  
  const pc = createPC(senderId);
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`✅ Remote desc установлен`);
    
    await processBuffer(senderId);
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    setTimeout(() => {
      socket.emit('answer', { targetId: senderId, answer: pc.localDescription });
    }, 500);
  } catch(e) { log(`Answer error: ${e.message}`); }
});

socket.on('answer', async ({senderId, answer}) => {
  log(`📥 Answer от ${senderId.substring(0,6)}`);
  
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
  log(`👤 ${id.substring(0,6)} вышел`);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  document.getElementById(`video-${id}`)?.remove();
});

socket.on('update-count', (count) => {
  document.getElementById('userCount').textContent = count;
});

// ===== УПРАВЛЕНИЕ =====

function toggleMic() {
  const track = localStream?.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('btnMic').textContent = track.enabled ? '🎤 ВКЛ' : '🔇 ВЫКЛ';
  }
}

function toggleCam() {
  const track = localStream?.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('btnCam').textContent = track.enabled ? '📷 ВКЛ' : '📵 ВЫКЛ';
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
  
  function check() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b) => a+b) / data.length;
    if (avg > 10) log('✅ Микрофон работает!');
    setTimeout(check, 2000);
  }
  check();
}

function copyLink() {
  navigator.clipboard.writeText(window.location.origin).then(() => {
    alert('Ссылка скопирована!');
  });
}

function stopVideo() {
  location.reload();
}
