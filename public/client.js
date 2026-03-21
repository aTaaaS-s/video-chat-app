const socket = io();

let localStream = null;
let peerConnections = {};
let roomId = null;
let userName = null;

// WebRTC конфигурация (публичные STUN сервера)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Вход в комнату
async function joinRoom() {
  userName = document.getElementById('userName').value.trim();
  roomId = document.getElementById('roomId').value.trim();

  if (!userName || !roomId) {
    alert('Введите имя и название комнаты!');
    return;
  }

  try {
    // Получаем доступ к камере и микрофону
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // Показываем своё видео
    addVideo(localStream, userName, true);

    // Переключаем экран
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    document.getElementById('displayRoomId').textContent = roomId;

    // Подключаемся к комнате
    socket.emit('join-room', { roomId, userName });

    // Сохраняем roomId в URL для удобства
    history.pushState({}, '', `?room=${roomId}`);

  } catch (err) {
    console.error('Ошибка доступа к медиа:', err);
    alert('Не удалось получить доступ к камере/микрофону. Проверьте разрешения.');
  }
}

// Создание PeerConnection
function createPeerConnection(targetId) {
  const pc = new RTCPeerConnection(rtcConfig);

  // Добавляем треки локального потока
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  // Когда получаем удалённый трек
  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    addVideo(remoteStream, targetId, false);
  };

  // ICE кандидаты
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        targetId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Состояние соединения с ${targetId}:`, pc.connectionState);
  };

  peerConnections[targetId] = pc;
  return pc;
}

// Обработка входящего соединения
socket.on('user-joined', async ({ id, name }) => {
  console.log('Пользователь присоединился:', name);
  const pc = createPeerConnection(id);

  // Создаем offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('offer', { targetId: id, offer });
});

// Получение offer
socket.on('offer', async ({ senderId, offer }) => {
  const pc = createPeerConnection(senderId);

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('answer', { targetId: senderId, answer });
});

// Получение answer
socket.on('answer', async ({ senderId, answer }) => {
  const pc = peerConnections[senderId];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

// Получение ICE кандидата
socket.on('ice-candidate', async ({ senderId, candidate }) => {
  const pc = peerConnections[senderId];
  if (pc && candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

// Пользователь вышел
socket.on('user-left', ({ id }) => {
  console.log('Пользователь вышел:', id);
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  const videoEl = document.getElementById(`video-${id}`);
  if (videoEl) videoEl.remove();
});

// Получаем список пользователей в комнате
socket.on('room-users', (users) => {
  console.log('Пользователи в комнате:', users);
  users.forEach(({ id, name }) => {
    createPeerConnection(id);
  });
});

// Добавление видео на страницу
function addVideo(stream, id, isLocal) {
  const container = document.getElementById('videosContainer');
  
  const wrapper = document.createElement('div');
  wrapper.className = `video-wrapper ${isLocal ? 'mirror' : ''}`;
  wrapper.id = `video-${id}`;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal; // Локальное видео без звука (чтобы не было эха)

  const nameTag = document.createElement('div');
  nameTag.className = 'user-name';
  nameTag.textContent = isLocal ? `${userName} (Вы)` : id;

  wrapper.appendChild(video);
  wrapper.appendChild(nameTag);
  container.appendChild(wrapper);
}

// Выход из комнаты
function leaveRoom() {
  // Закрываем все соединения
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  // Останавливаем медиа
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Очищаем видео
  document.getElementById('videosContainer').innerHTML = '';

  // Возвращаемся на экран входа
  document.getElementById('chatScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('userName').value = '';
  document.getElementById('roomId').value = '';

  roomId = null;
  userName = null;
}

// Копирование ссылки
function copyLink() {
  const url = `${window.location.origin}?room=${roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ Ссылка скопирована!');
  }).catch(() => {
    prompt('Скопируйте ссылку:', url);
  });
}

// Вкл/Выкл микрофон
function toggleMic() {
  const btn = document.getElementById('btnMic');
  const audioTrack = localStream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    btn.classList.toggle('active', !audioTrack.enabled);
  }
}

// Вкл/Выкл камеру
function toggleCam() {
  const btn = document.getElementById('btnCam');
  const videoTrack = localStream?.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    btn.classList.toggle('active', !videoTrack.enabled);
  }
}

// Авто-вход если в URL есть ?room=XXX
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    document.getElementById('roomId').value = roomParam;
  }
});
