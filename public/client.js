let socket;
let localStream;
let peers = new Map();
let currentUserName = null;
let myId = null;
let audioEnabled = true;
let videoEnabled = true;

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const chatScreen = document.getElementById('chatScreen');
const videoGrid = document.getElementById('videoGrid');
const participantCountSpan = document.getElementById('participantCount');

window.onload = () => {
    console.log('App loaded');
};

function joinChat() {
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('Please enter your name');
        return;
    }
    
    currentUserName = userName;
    
    // Подключаемся к серверу
    socket = io({
        transports: ['websocket', 'polling']
    });
    
    setupSocketListeners();
    socket.emit('join', userName);
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('✅ Connected to server, ID:', socket.id);
    });
    
    socket.on('room-data', async (data) => {
        console.log('📋 Room data received');
        myId = data.yourId;
        
        // Показываем интерфейс чата
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        
        // Добавляем существующих участников
        for (const participant of data.participants) {
            if (participant.id !== myId) {
                console.log('Adding existing participant:', participant.name);
                await addRemoteVideo(participant.id, participant.name);
            }
        }
        
        // Запускаем локальный стрим
        await startLocalStream();
    });
    
    socket.on('user-joined', async (data) => {
        console.log('👤 User joined:', data.userName, data.userId);
        if (data.userId !== myId) {
            await addRemoteVideo(data.userId, data.userName);
        }
    });
    
    socket.on('user-left', (data) => {
        console.log('👋 User left:', data.userName, data.userId);
        removeRemoteVideo(data.userId);
    });
    
    socket.on('offer', async (data) => {
        console.log('📞 Offer from:', data.fromName);
        
        if (!peers.has(data.from)) {
            const pc = createPeerConnection(data.from);
            peers.set(data.from, { peer: pc, name: data.fromName });
            
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('answer', { target: data.from, answer });
                console.log('✅ Answer sent to:', data.fromName);
            } catch (err) {
                console.error('Error handling offer:', err);
            }
        }
    });
    
    socket.on('answer', async (data) => {
        console.log('📞 Answer from:', data.from);
        const peerData = peers.get(data.from);
        if (peerData) {
            try {
                await peerData.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('✅ Remote description set for:', data.from);
            } catch (err) {
                console.error('Error handling answer:', err);
            }
        }
    });
    
    socket.on('ice-candidate', (data) => {
        console.log('❄️ ICE candidate from:', data.from);
        const peerData = peers.get(data.from);
        if (peerData) {
            peerData.peer.addIceCandidate(new RTCIceCandidate(data.candidate))
                .catch(err => console.error('Error adding ICE candidate:', err));
        }
    });
    
    socket.on('error', (msg) => {
        console.error('Socket error:', msg);
        alert(msg);
    });
}

async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        addLocalVideo();
        updateParticipantCount();
        
        console.log('🎥 Local stream started');
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Cannot access camera/microphone. Please check permissions and try again.');
    }
}

function addLocalVideo() {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${myId}`;
    
    const video = document.createElement('video');
    video.srcObject = localStream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Mute local video to prevent echo
    
    const username = document.createElement('div');
    username.className = 'username';
    username.textContent = `${currentUserName} (You)`;
    
    const audioIndicator = document.createElement('div');
    audioIndicator.className = 'audio-indicator';
    audioIndicator.id = `audio-indicator-${myId}`;
    audioIndicator.textContent = '🔊';
    
    container.appendChild(video);
    container.appendChild(username);
    container.appendChild(audioIndicator);
    videoGrid.appendChild(container);
    
    // Отслеживаем уровень звука для индикатора
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(localStream);
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        function checkAudio() {
            if (!audioTrack.enabled) {
                audioIndicator.textContent = '🔇';
            } else {
                analyser.getByteTimeDomainData(dataArray);
                let max = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const v = Math.abs(dataArray[i] - 128) / 128;
                    if (v > max) max = v;
                }
                audioIndicator.textContent = max > 0.05 ? '🎤' : '🔊';
            }
            requestAnimationFrame(checkAudio);
        }
        checkAudio();
    }
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            // Публичные STUN серверы
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:stun.voip.blackberry.com:3478' }
        ],
        iceCandidatePoolSize: 10
    });
    
    // Добавляем все треки из локального стрима
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log('Added track to peer:', track.kind);
        });
    }
    
    // Отправляем ICE кандидаты
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate:', event.candidate.type);
            socket.emit('ice-candidate', {
                target: targetId,
                candidate: event.candidate
            });
        }
    };
    
    // Отслеживаем состояние ICE соединения
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state for ${targetId}: ${pc.iceConnectionState}`);
        const container = document.getElementById(`video-${targetId}`);
        if (container) {
            const indicator = container.querySelector('.username');
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                if (indicator) indicator.style.background = 'rgba(0,128,0,0.7)';
            } else if (pc.iceConnectionState === 'failed') {
                if (indicator) indicator.style.background = 'rgba(255,0,0,0.7)';
            }
        }
    };
    
    // Получаем удаленные треки (видео и звук)
    pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        const container = document.getElementById(`video-${targetId}`);
        if (container) {
            const video = container.querySelector('video');
            if (video && !video.srcObject) {
                video.srcObject = event.streams[0];
                video.play().catch(console.error);
                console.log('✅ Remote stream attached to video element');
            }
        }
    };
    
    return pc;
}

async function addRemoteVideo(userId, userName) {
    if (userId === myId) return;
    if (document.getElementById(`video-${userId}`)) return;
    
    console.log('Adding remote video for:', userName);
    
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${userId}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    
    const username = document.createElement('div');
    username.className = 'username';
    username.textContent = userName;
    
    const audioIndicator = document.createElement('div');
    audioIndicator.className = 'audio-indicator';
    audioIndicator.textContent = '🔊';
    
    container.appendChild(video);
    container.appendChild(username);
    container.appendChild(audioIndicator);
    videoGrid.appendChild(container);
    
    // Создаем peer connection
    const pc = createPeerConnection(userId);
    peers.set(userId, { peer: pc, name: userName });
    
    // Создаем offer
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', {
            target: userId,
            offer: pc.localDescription
        });
        console.log('✅ Offer sent to:', userName);
    } catch (err) {
        console.error('Error creating offer:', err);
    }
    
    updateParticipantCount();
}

function removeRemoteVideo(userId) {
    const container = document.getElementById(`video-${userId}`);
    if (container) {
        container.remove();
    }
    
    const peerData = peers.get(userId);
    if (peerData) {
        peerData.peer.close();
        peers.delete(userId);
    }
    
    updateParticipantCount();
}

function updateParticipantCount() {
    const count = document.querySelectorAll('.video-container').length;
    participantCountSpan.textContent = count;
}

function toggleAudio() {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack) {
        audioEnabled = !audioEnabled;
        audioTrack.enabled = audioEnabled;
        const btn = document.getElementById('audioBtn');
        btn.textContent = audioEnabled ? '🎤 Mute' : '🔇 Unmute';
        
        // Обновляем индикатор у себя
        const indicator = document.getElementById(`audio-indicator-${myId}`);
        if (indicator) {
            indicator.textContent = audioEnabled ? '🎤' : '🔇';
        }
        
        console.log('Audio:', audioEnabled ? 'ON' : 'OFF');
    }
}

function toggleVideo() {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
        videoEnabled = !videoEnabled;
        videoTrack.enabled = videoEnabled;
        const btn = document.getElementById('videoBtn');
        btn.textContent = videoEnabled ? '📹 Stop Video' : '📹 Start Video';
        console.log('Video:', videoEnabled ? 'ON' : 'OFF');
    }
}

async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true,
            audio: false
        });
        
        const videoTrack = screenStream.getVideoTracks()[0];
        const oldVideoTrack = localStream.getVideoTracks()[0];
        
        // Заменяем видео трек
        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(videoTrack);
        
        // Обновляем локальное видео
        const localVideo = document.querySelector(`#video-${myId} video`);
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        // Обновляем все пир-соединения
        peers.forEach((peerData) => {
            const sender = peerData.peer.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
        });
        
        videoTrack.onended = () => {
            // Возвращаем камеру когда экран закрыли
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    const newVideoTrack = stream.getVideoTracks()[0];
                    localStream.removeTrack(videoTrack);
                    localStream.addTrack(newVideoTrack);
                    
                    peers.forEach((peerData) => {
                        const sender = peerData.peer.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) {
                            sender.replaceTrack(newVideoTrack);
                        }
                    });
                    
                    const localVideo = document.querySelector(`#video-${myId} video`);
                    if (localVideo) {
                        localVideo.srcObject = localStream;
                    }
                });
        };
        
        console.log('Screen sharing started');
    } catch (error) {
        console.error('Error sharing screen:', error);
        alert('Screen sharing failed: ' + error.message);
    }
}

function leaveRoom() {
    // Останавливаем все треки
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Закрываем все пир-соединения
    peers.forEach((peerData) => {
        peerData.peer.close();
    });
    peers.clear();
    
    // Очищаем грид
    videoGrid.innerHTML = '';
    
    // Показываем экран входа
    loginScreen.style.display = 'flex';
    chatScreen.style.display = 'none';
    
    // Очищаем поле ввода
    document.getElementById('userName').value = '';
    
    // Отключаем сокет
    if (socket) {
        socket.disconnect();
    }
    
    console.log('Left room');
}

function copyRoomLink() {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    alert('🔗 Link copied to clipboard!\nShare this link with friends to join the chat.');
}

// Автоматическая переподключка при потере соединения
setInterval(() => {
    if (socket && !socket.connected) {
        console.log('Reconnecting...');
        socket.connect();
    }
}, 5000);
