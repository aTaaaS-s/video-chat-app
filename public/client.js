const socket = io();
let localStream = null;
let peerConnections = {};
let userName = null;
let usersMap = {}; // Сохраняем имена

// НУЖНЫ ХОРОШИЕ TURN СЕРВЕРА!
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
    },
    {
      urls: 'turn:openrelay.metered.ca:8080',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'
};

function log(msg) {
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  document.getElementById('log').appendChild(div);
  document.getElementById('log').scrollTop = document.getElementById('log').scrollHeight;
  console.log(msg);
}

async function joinChat() {
  userName = document.getElementById('nameInput').value.trim() || 'User';
  
  log('🚀 Подключение...');
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: { 
        echoCancellation: true, 
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    log('✅ Доступ получен');
    log(`🎤 Аудио: ${localStream.getAudioTracks().length}`);
    log(`📹 Видео: ${localStream.getVideoTracks().length}`);
    
    // Проверяем треки
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    log(`🎤 Аудио включён: ${audioTrack?.enabled}`);
    log(`📹 Видео включено: ${videoTrack?.enabled}`);
    
    addVideo(localStream, 'local', true);
    
    document.getElementById('login').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    
    socket.emit('join', userName);
    log('📤 Join отправлен');
    
    setTimeout(startAudioMonitoring, 2000);
    
  } catch (err) {
    alert('Ошибка: ' + err.message);
    log('❌ ' + err.message);
  }
}

function addVideo(stream, id, isLocal) {
  const existing = document.getElementById('video-' + id);
  if (existing) {
    log('⚠️ Видео уже есть: ' + id);
    return;
  }
  
  const displayName = isLocal ? userName : (usersMap[id] || id.substring(0, 8));
  log('🎬 Видео: ' + displayName);
  
  const wrap = document.createElement('div');
  wrap.className = 'video-wrap' + (isLocal ? ' mirror' : '');
  wrap.id = 'video-' + id;
  
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;
  
  // Проверяем загружено ли видео
  video.onloadedmetadata = () => {
    log(`✅ Видео ${displayName} загружено: ${video.videoWidth}x${video.videoHeight}`);
  };
  
  video.onplay = () => {
    log(`▶️ Видео ${displayName} воспроизводится`);
  };
  
  const label = document.createElement('div');
  label.className = 'user-label';
  label.textContent = isLocal ? userName + ' (Вы)' : displayName;
  
  wrap.appendChild(video);
  wrap.appendChild(label);
  document.getElementById('videos').appendChild(wrap);
  
  // Проверяем треки через 2 секунды
  setTimeout(() => {
    const tracks = stream.getTracks();
    log(`📹 ${displayName}: ${tracks.length} треков`);
    tracks.forEach(t => {
      log(`  - ${t.kind}: enabled=${t.enabled}, muted=${t.muted}`);
    });
  }, 2000);
}

function startAudioMonitoring() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (!audioTrack) {
    log('❌ Нет аудио трека');
    return;
  }
  
  log('🎤 Тест микрофона...');
  
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  
  const source = audioContext.createMediaStreamSource(localStream);
  source.connect(analyser);
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  let checks = 0;
  function check() {
    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a,b) => a+b) / dataArray.length;
    const peak = Math.max(...dataArray);
    
    checks++;
    if (checks <= 5) {
      log(`🎤 Уровень #${checks}: ${Math.round(avg)} (пик: ${peak})`);
      if (avg > 10) log('✅ МИКРОФОН РАБОТАЕТ!');
    }
    
    setTimeout(check, 2000);
  }
  check();
}

function createPC(targetId) {
  if (peerConnections[targetId]) {
    return peerConnections[targetId];
  }
  
  const name = usersMap[targetId] || targetId.substring(0, 8);
  log(`🔧 PC для ${name} (${targetId})`);
  
  const pc = new RTCPeerConnection(rtcConfig);
  
  // Добавляем треки
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    log(`  Добавлен ${track.kind} трек`);
  });
  
  // Получение треков
  pc.ontrack = (e) => {
    log(`📥 Получен ${e.track.kind} от ${name}`);
    log(`  Stream ID: ${e.streams[0].id}`);
    log(`  Track enabled: ${e.track.enabled}`);
    log(`  Track muted: ${e.track.muted}`);
    
    // Проверяем стрим
    const stream = e.streams[0];
    const tracks = stream.getTracks();
    log(`  В стриме ${tracks.length} треков`);
    tracks.forEach(t => log(`    - ${t.kind}: enabled=${t.enabled}`));
    
    addVideo(stream, targetId, false);
  };
  
  // ICE кандидаты
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      log(`❄️ ICE кандидат для ${name}`);
      socket.emit('ice', { to: targetId, ice: e.candidate });
    }
  };
  
  // Состояние ICE
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`🔌 ICE ${state} (${name})`);
    
    if (state === 'connected' || state === 'completed') {
      log('✅ СОЕДИНЕНИЕ УСТАНОВЛЕНО!');
    } else if (state === 'failed') {
      log('❌ ICE FAILED - проблема с соединением');
      log('💡 Попробуйте использовать VPN или проверьте firewall');
    } else if (state === 'disconnected') {
      log('⚠️ ICE DISCONNECTED');
    }
  };
  
  pc.onconnectionstatechange = () => {
    log(`📡 Connection: ${pc.connectionState}`);
  };
  
  pc.onnegotiationneeded = () => {
    log('🔄 Negotiation needed');
  };
  
  peerConnections[targetId] = pc;
  log('✅ PC создан');
  return pc;
}

// ===== СОБЫТИЯ =====

socket.on('connect', () => {
  log('🔌 Подключён к серверу: ' + socket.id);
});

socket.on('usersList', (users) => {
  log(`👥 В чате ${users.length} других`);
  
  // Сохраняем имена
  users.forEach(u => {
    usersMap[u.id] = u.name;
    log(`  - ${u.name} (${u.id.substring(0,8)})`);
  });
  
  // Создаём PC
  users.forEach(u => createPC(u.id));
});

socket.on('userJoined', ({id, name}) => {
  log(`👤 ${name} (${id.substring(0,8)}) присоединился`);
  
  if (id === socket.id) {
    log('Это мы сами');
    return;
  }
  
  // Сохраняем имя
  usersMap[id] = name;
  
  const pc = createPC(id);
  
  setTimeout(async () => {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      log('📤 Offer создан');
      
      // Ждём ICE кандидаты
      setTimeout(() => {
        socket.emit('offer', { 
          to: id, 
          offer: pc.localDescription 
        });
        log('📤 Offer отправлен');
      }, 1000);
      
    } catch(e) {
      log('❌ Offer error: ' + e.message);
    }
  }, 500);
});

socket.on('offer', async ({from, offer}) => {
  const name = usersMap[from] || from.substring(0, 8);
  log(`📥 Offer от ${name}`);
  
  const pc = createPC(from);
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log('✅ Remote description установлен');
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log('📤 Answer создан');
    
    setTimeout(() => {
      socket.emit('answer', { 
        to: from, 
        answer: pc.localDescription 
      });
      log('📤 Answer отправлен');
    }, 1000);
    
  } catch(e) {
    log('❌ Answer error: ' + e.message);
  }
});

socket.on('answer', async ({from, answer}) => {
  const name = usersMap[from] || from.substring(0, 8);
  log(`📥 Answer от ${name}`);
  
  const pc = peerConnections[from];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      log('✅ Remote description (answer) установлен');
    } catch(e) {
      log('❌ Answer error: ' + e.message);
    }
  }
});

socket.on('ice', async ({from, ice}) => {
  const name = usersMap[from] || from.substring(0, 8);
  
  const pc = peerConnections[from];
  if (pc && ice) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(ice));
      log(`✅ ICE от ${name} добавлен`);
    } catch(e) {
      log(`⚠️ ICE ошибка: ${e.message}`);
    }
  }
});

socket.on('userLeft', ({id}) => {
  const name = usersMap[id] || id.substring(0, 8);
  log(`👤 ${name} вышел`);
  
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  if (usersMap[id]) {
    delete usersMap[id];
  }
  
  document.getElementById('video-' + id)?.remove();
});

socket.on('count', (n) => {
  document.getElementById('count').textContent = n;
  log(`👥 Участников: ${n}`);
});

// ===== УПРАВЛЕНИЕ =====

function toggleMic() {
  const track = localStream?.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    const btn = document.getElementById('btnMic');
    btn.textContent = track.enabled ? '🎤 Микрофон ВКЛ' : '🔇 ВЫКЛ';
    btn.className = track.enabled ? 'success' : 'active';
    log(track.enabled ? '🎤 ВКЛ' : '🔇 ВЫКЛ');
  }
}

function toggleCam() {
  const track = localStream?.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    const btn = document.getElementById('btnCam');
    btn.textContent = track.enabled ? '📷 Камера ВКЛ' : '📵 ВЫКЛ';
    btn.className = track.enabled ? 'success' : 'active';
    log(track.enabled ? '📷 ВКЛ' : '📵 ВЫКЛ');
  }
}

function copyLink() {
  navigator.clipboard.writeText(window.location.origin).then(() => {
    alert('✅ Ссылка:\n\n' + window.location.origin);
  });
}
