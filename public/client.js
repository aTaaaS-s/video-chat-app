let socket;
let localStream;
let peer;
let peers = new Map();
let currentRoomId = null;
let currentUserName = null;

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const chatScreen = document.getElementById('chatScreen');
const videoGrid = document.getElementById('videoGrid');
const currentRoomIdSpan = document.getElementById('currentRoomId');
const participantCountSpan = document.getElementById('participantCount');

// Инициализация при загрузке
window.onload = () => {
    socket = io();
    setupSocketListeners();
};

function setupSocketListeners() {
    socket.on('room-created', (roomId) => {
        currentRoomId = roomId;
        joinVideoRoom();
    });
    
    socket.on('room-joined', (data) => {
        currentRoomId = data.roomId;
        currentRoomIdSpan.textContent = currentRoomId;
        
        // Отображаем существующих участников
        data.participants.forEach(participant => {
            if (participant.id !== socket.id) {
                addRemoteVideo(participant.id, participant.name);
            }
        });
        
        joinVideoRoom();
    });
    
    socket.on('user-joined', (data) => {
        addRemoteVideo(data.userId, data.userName);
    });
    
    socket.on('user-left', (data) => {
        removeRemoteVideo(data.userId);
    });
    
    socket.on('offer', async (data) => {
        if (!peers.has(data.from)) {
            const peer = createPeerConnection(data.from, data.fromName);
            peers.set(data.from, { peer, name: data.fromName });
            await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.emit('answer', { target: data.from, answer });
        }
    });
    
    socket.on('answer', async (data) => {
        const peerConnection = peers.get(data.from)?.peer;
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });
    
    socket.on('ice-candidate', (data) => {
        const peerConnection = peers.get(data.from)?.peer;
        if (peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });
}

async function joinVideoRoom() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addLocalVideo();
        
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        
        updateParticipantCount();
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Cannot access camera/microphone. Please check permissions.');
    }
}

function addLocalVideo() {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${socket.id}`;
    
    const video = document.createElement('video');
    video.srcObject = localStream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    
    const username = document.createElement('div');
    username.className = 'username';
    username.textContent = `${currentUserName} (You)`;
    
    container.appendChild(video);
    container.appendChild(username);
    videoGrid.appendChild(container);
}

function createPeerConnection(targetUserId, userName) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    
    // Добавляем локальный трек
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetUserId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnection.ontrack = (event) => {
        const container = document.getElementById(`video-${targetUserId}`);
        if (container) {
            const video = container.querySelector('video');
            if (video && !video.srcObject) {
                video.srcObject = event.streams[0];
                video.autoplay = true;
                video.playsInline = true;
            }
        }
    };
    
    return peerConnection;
}

function addRemoteVideo(userId, userName) {
    if (userId === socket.id) return;
    
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${userId}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    
    const username = document.createElement('div');
    username.className = 'username';
    username.textContent = userName;
    
    container.appendChild(video);
    container.appendChild(username);
    videoGrid.appendChild(container);
    
    // Создаем peer connection для этого пользователя
    const peerConnection = createPeerConnection(userId, userName);
    peers.set(userId, { peer: peerConnection, name: userName });
    
    // Создаем offer
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            socket.emit('offer', {
                target: userId,
                offer: peerConnection.localDescription
            });
        })
        .catch(error => console.error('Error creating offer:', error));
    
    updateParticipantCount();
}

function removeRemoteVideo(userId) {
    const container = document.getElementById(`video-${userId}`);
    if (container) {
        container.remove();
    }
    
    const peerConnection = peers.get(userId)?.peer;
    if (peerConnection) {
        peerConnection.close();
        peers.delete(userId);
    }
    
    updateParticipantCount();
}

function updateParticipantCount() {
    const count = document.querySelectorAll('.video-container').length;
    participantCountSpan.textContent = count;
}

function createRoom() {
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('Please enter your name');
        return;
    }
    currentUserName = userName;
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.emit('create-room', roomId, userName);
}

function joinRoom() {
    const userName = document.getElementById('userName').value.trim();
    const roomId = document.getElementById('roomId').value.trim().toUpperCase();
    
    if (!userName) {
        alert('Please enter your name');
        return;
    }
    if (!roomId) {
        alert('Please enter room ID');
        return;
    }
    
    currentUserName = userName;
    socket.emit('join-room', roomId, userName);
}

function leaveRoom() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    peers.forEach((value, key) => {
        value.peer.close();
    });
    peers.clear();
    
    videoGrid.innerHTML = '';
    loginScreen.style.display = 'flex';
    chatScreen.style.display = 'none';
    
    document.getElementById('userName').value = '';
    document.getElementById('roomId').value = '';
}

function copyRoomLink() {
    const link = `${window.location.href}?room=${currentRoomId}`;
    navigator.clipboard.writeText(link);
    alert('Room link copied to clipboard!');
}

function toggleAudio() {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('audioBtn');
        btn.textContent = audioTrack.enabled ? '🎤 Mute' : '🔇 Unmute';
        
        // Обновляем статус на всех видео
        document.querySelectorAll('.audio-status').forEach(status => {
            status.textContent = audioTrack.enabled ? '🔊' : '🔇';
        });
    }
}

function toggleVideo() {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const btn = document.getElementById('videoBtn');
        btn.textContent = videoTrack.enabled ? '📹 Stop Video' : '📹 Start Video';
        
        const localVideo = document.querySelector(`#video-${socket.id} video`);
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
    }
}

async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        
        // Заменяем видео трек
        const videoTrack = screenStream.getVideoTracks()[0];
        const oldVideoTrack = localStream.getVideoTracks()[0];
        
        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(videoTrack);
        
        // Обновляем локальное видео
        const localVideo = document.querySelector(`#video-${socket.id} video`);
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        // Обновляем все peer connections
        peers.forEach((value, key) => {
            const sender = value.peer.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
        });
        
        videoTrack.onended = () => {
            // Возвращаемся к обычной камере
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    const newVideoTrack = stream.getVideoTracks()[0];
                    localStream.removeTrack(videoTrack);
                    localStream.addTrack(newVideoTrack);
                    
                    peers.forEach((value, key) => {
                        const sender = value.peer.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) {
                            sender.replaceTrack(newVideoTrack);
                        }
                    });
                    
                    const localVideo = document.querySelector(`#video-${socket.id} video`);
                    if (localVideo) {
                        localVideo.srcObject = localStream;
                    }
                });
        };
    } catch (error) {
        console.error('Error sharing screen:', error);
    }
}

// Обработка ссылки с параметром комнаты
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
    document.getElementById('roomId').value = roomFromUrl;
}