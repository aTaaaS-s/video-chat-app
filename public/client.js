const socket = io();
let localStream = null;
let peerConnections = {};
let userName = null;
let audioContext, analyser, dataArray;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

function log(msg) {
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  document.getElementById('log').appendChild(div);
  document.getElementById('log').scrollTop = document.getElementById('log').scrollHeight;
  console.log(msg);
}

async function join() {
  userName = document.getElementById('nameInput').value.trim() || 'User';
  
  try {
    // Получаем доступ к микрофону и камере
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: { 
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    log('✅ Доступ получен');
    log(`🎤 Аудио: ${localStream.getAudioTracks().length} трек`);
    log(`📹 Видео: ${localStream.getVideoTracks().length} трек`);
    
    // Показываем своё видео
    addVideo(localStream, userName, true);
    
    // Запускаем прослушивание микрофона
    startAudioMonitoring();
    
    document.getElementById('login').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    
    // Подключаемся к комнате
    socket.emit('join', { name: userName });
    log('📤 Отправлено join');
    
  } catch (err) {
    alert('Ошибка: ' + err.message);
  }
}

function addVideo(stream, id, isLocal) {
  if (document.getElementById('video-' + id)) return;
  
  log(`🎬 Видео: ${isLocal ? 'ваше' : id}`);
  
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
  label.textContent = isLocal ? userName + ' (Вы)' : id;
  
  wrap.appendChild(video);
  wrap.appendChild(label);
  document.getElementById('videos').appendChild(wrap);
  
  // Проверяем треки
  setTimeout(() => {
    const tracks = stream.getTracks();
    log(`📹 ${id}: ${tracks.length} треков`);
    tracks.forEach(t => log(`  - ${t.kind}: ${t.enabled ? 'вкл' : 'выкл'}`));
  }, 1000);
}

// ===== ПРОСЛУШИВАНИЕ МИКРОФОНА =====
function startAudioMonitoring() {
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) {
    log('❌ Аудио трек не найден');
    return;
  }
  
  log('🎤 Запуск мониторинга микрофона...');
  
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    const source = audioContext.createMediaStreamSource(localStream);
    source.connect(analyser);
    
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    log('✅ Мониторинг запущен');
    checkAudioLevel();
    
  } catch (err) {
    log('❌ Ошибка мониторинга: ' + err.message);
  }
}

function checkAudioLevel() {
  if (!analyser) return;
  
  analyser.getByteFrequencyData(dataArray);
  
  // Считаем средний уровень
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const average = sum / dataArray.length;
  const peak = Math.max(...dataArray);
  
  // Показываем уровень
  if (average > 0) {
    log(`🎤 Уровень: ${Math.round(average)} (пик: ${peak})`);
    
    if (average > 10) {
      log('✅ МИКРОФОН РАБОТАЕТ!');
    }
  }
  
  // Проверяем каждую секунду
  setTimeout(checkAudioLevel, 1000);
}

function createPC(targetId) {
  if (peerConnections[targetId]) return peerConnections[targetId];
  
  log(`🔧 PC для ${targetId}`);
  
  const pc = new RTCPeerConnection(rtcConfig);
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  pc.ontrack = (e) => {
    log(`📥 Получен ${e.track.kind} от ${targetId}`);
    addVideo(e.streams[0], targetId, false);
  };
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice', { to: targetId, ice: e.candidate });
    }
  };
  
  pc.oniceconnectionstatechange = () => {
    log(`🔌 ICE: ${pc.iceConnectionState} (${targetId.substring(0,6)})`);
  };
  
  peerConnections[targetId] = pc;
  return pc;
}

// ===== СОБЫТИЯ =====

socket.on('usersList', (users) => {
  log(`👥 В комнате: ${users.length} других`);
  users.forEach(u => {
    log(`  - ${u.name}`);
    createPC(u.id);
  });
});

socket.on('userJoined', async ({id, name}) => {
  log(`👤 ${name} (${id.substring(0,6)}) вошёл`);
  
  if (id === socket.id) return;
  
  const pc = createPC(id);
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    setTimeout(() => {
      socket.emit('offer', { to: id, offer: pc.localDescription });
    }, 500);
  } catch(e) { log('Offer error: ' + e.message); }
});

socket.on('offer', async ({from, offer}) => {
  log(`📥 Offer от ${from.substring(0,6)}`);
  
  const pc = createPC(from);
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    setTimeout(() => {
      socket.emit('answer', { to: from, answer: pc.localDescription });
    }, 500);
  } catch(e) { log('Answer error: ' + e.message); }
});

socket.on('answer', async ({from, answer}) => {
  log(`📥 Answer от ${from.substring(0,6)}`);
  
  const pc = peerConnections[from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('ice', async ({from, ice}) => {
  const pc = peerConnections[from];
  if (pc && ice) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(ice));
    } catch(e) {}
  }
});

socket.on('userLeft', ({id}) => {
  log(`👤 ${id.substring(0,6)} вышел`);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  document.getElementById('video-' + id)?.remove();
});

socket.on('count', (n) => {
  document.getElementById('count').textContent = n;
});

// ===== УПРАВЛЕНИЕ =====

function toggleMic() {
  const track = localStream?.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('btnMic').textContent = track.enabled ? '🎤 ВКЛ' : '🔇 ВЫКЛ';
    document.getElementById('btnMic').className = track.enabled ? 'success' : 'active';
  }
}

function toggleCam() {
  const track = localStream?.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('btnCam').textContent = track.enabled ? '📷 ВКЛ' : '📵 ВЫКЛ';
    document.getElementById('btnCam').className = track.enabled ? 'success' : 'active';
  }
}

function copyLink() {
  navigator.clipboard.writeText(window.location.origin).then(() => {
    alert('Ссылка: ' + window.location.origin);
  });
}
