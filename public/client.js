const socket = io();

let localStream = null;
let peerConnections = {};
let roomId = null;
let userName = null;

// WebRTC конфигурация
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ===== ФУНКЦИЯ ДОБАВЛЕНИЯ ВИДЕО (должна быть первой!) =====
function addVideo(stream, id, isLocal) {
  const container = document.getElementById('videosContainer');
  
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
}

// ===== ВХОД В КОМНАТУ =====
async function joinRoom() {
  userName = document.getElementById('userName').value.trim();
  roomId = document.getElementById('roomId').value.trim();

  if (!userName || !roomId) {
    alert('Введите имя и название комнаты!');
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: { 
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    // Показываем своё видео
    addVideo(localStream, userName, true);

    // Обновляем статусы
    updateStatus('mic', localStream.getAudioTracks()[0]);
    updateStatus('cam', localStream.getVideoTracks()[0]);

    // Переключаем экран
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    document.getElementById('displayRoomId').textContent = roomId;

    // Подключаемся к комнате
    socket.emit('join-room', { roomId, userName });

    // Сохраняем в URL
    history.pushState({}, '', `?room=${roomId}`);

  } catch (err) {
    console.error('Ошибка:', err);
    alert('Не удалось получить доступ к камере/микрофону:\n' + err.message);
  }
}

// ===== СОЗДАНИЕ PEER CONNECTION =====
function createPeerConnection(targetId) {
  const pc = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    addVideo(remoteStream, targetId, false);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        targetId,
        candidate: event.candidate
      });
    }
  };

  peerConnections[targetId] = pc;
  return pc;
}

// ===== СОБЫТИЯ SOCKET.IO =====
socket.on('user-joined', async ({ id, name }) => {
  console.log('Пользователь присоединился:', name);
  const pc = createPeerConnection(id);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('offer', { targetId: id, offer });
});

socket.on('offer', async ({ senderId, offer }) => {
  const pc = createPeerConnection(senderId);

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('answer', { targetId: senderId, answer });
});

socket.on('answer', async ({ senderId, answer }) => {
  const pc = peerConnections[senderId];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('ice-candidate', async ({ senderId, candidate }) => {
  const pc = peerConnections[senderId];
  if (pc && candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on('user-left', ({ id }) => {
  console.log('Пользователь вышел:', id);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  const videoEl = document.getElementById(`video-${id}`);
  if (videoEl) videoEl.remove();
});

socket.on('room-users', (users) => {
  console.log('Пользователи в комнате:', users);
  users.forEach(({ id }) => {
    createPeerConnection(id);
  });
});

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function leaveRoom() {
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  document.getElementById('videosContainer').innerHTML = '';
  document.getElementById('chatScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('userName').value = '';
  document.getElementById('roomId').value = '';

  roomId = null;
  userName = null;
}

function copyLink() {
  const url = `${window.location.origin}?room=${roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ Ссылка скопирована!');
  }).catch(() => {
    prompt('Скопируйте ссылку:', url);
  });
}

function toggleMic() {
  const btn = document.getElementById('btnMic');
  const audioTrack = localStream?.getAudioTracks()[0];
  
  if (!audioTrack) {
    alert('⚠️ Микрофон не найден!');
    return;
  }
  
  audioTrack.enabled = !audioTrack.enabled;
  btn.classList.toggle('active', !audioTrack.enabled);
  updateStatus('mic', audioTrack);
}

function toggleCam() {
  const btn = document.getElementById('btnCam');
  const videoTrack = localStream?.getVideoTracks()[0];
  
  if (!videoTrack) {
    alert('⚠️ Камера не найдена!');
    return;
  }
  
  videoTrack.enabled = !videoTrack.enabled;
  btn.classList.toggle('active', !videoTrack.enabled);
  updateStatus('cam', videoTrack);
}

function updateStatus(type, track) {
  const statusEl = document.getElementById(`${type}Status`);
  if (!statusEl || !track) return;
  
  const icon = type === 'mic' ? '🎤' : '📹';
  const status = track.enabled ? '✓' : '✗';
  statusEl.textContent = `${icon} ${status}`;
}

function testAudio() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (audioTrack) {
    const settings = audioTrack.getSettings();
    alert(`Микрофон:\n• Название: ${audioTrack.label}\n• Включен: ${audioTrack.enabled}\n• Устройство: ${settings.deviceId || 'default'}`);
  } else {
    alert('Микрофон не найден!');
  }
}

// ===== АВТОВХОД ИЗ URL =====
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    document.getElementById('roomId').value = roomParam;
  }
});
