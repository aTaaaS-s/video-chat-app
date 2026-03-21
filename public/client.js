let socket;
let localStream;
let peers = new Map();
let currentRoomId = null;
let currentUserName = null;

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const chatScreen = document.getElementById('chatScreen');
const videoGrid = document.getElementById('videoGrid');
const currentRoomIdSpan = document.getElementById('currentRoomId');
const participantCountSpan = document.getElementById('participantCount');

// Инициализация
window.onload = () => {
    socket = io({
        transports: ['websocket', 'polling']
    });
    setupSocketListeners();
};

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server, socket ID:', socket.id);
    });
    
    socket.on('room-created', (roomId) => {
        console.log('Room created:', roomId);
        currentRoomId = roomId;
        currentRoomIdSpan.textContent = currentRoomId;
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        startLocalStream();
    });
    
    socket.on('room-joined', (data) => {
        console.log('Joined room:', data.roomId, 'Participants:', data.participants);
        currentRoomId = data.roomId;
        currentRoomIdSpan.textContent = currentRoomId;
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        
        // Добавляем существующих участников
        data.participants.forEach(participant => {
            if (participant.id !== socket.id) {
                console.log('Adding existing participant:', participant.name);
                addRemoteVideo(participant.id, participant.name);
            }
        });
        
        startLocalStream();
    });
    
    socket.on('participants-list', (participants) => {
        console.log('Participants list:', participants);
        participants.forEach(participant => {
            if (participant.id !== socket.id) {
                addRemoteVideo(participant.id, participant.name);
            }
        });
    });
    
    socket.on('user-joined', (data) => {
        console.log('User joined:', data.userName, data.userId);
        addRemoteVideo(data.userId, data.userName);
    });
    
    socket.on('user-left', (data) => {
        console.log('User left:', data.userName, data.userId);
        removeRemoteVideo(data.userId);
    });
    
    socket.on('offer', async (data) => {
        console.log('Received offer from:', data.fromName);
        if (!peers.has(data.from)) {
            const peerConnection = createPeerConnection(data.from, data.fromName);
            peers.set(data.from, { peer: peerConnection, name: data.fromName });
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', { target: data.from, answer });
        }
    });
    
    socket.on('answer', async (data) => {
        console.log('Received answer from:', data.from);
        const peerConnection = peers.get(data.from)?.peer;
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });
    
    socket.on('ice-candidate', (data) => {
        console.log('Received ICE candidate from:', data.from);
        const peerConnection = peers.get(data.from)?.peer;
        if (peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });
    
    socket.on('error', (msg) => {
        console.error('Socket error:', msg);
        alert(msg);
    });
}

async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addLocalVideo();
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
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    });
    
    // Добавляем локальные треки
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to:', targetUserId);
            socket.emit('ice-candidate', {
                target: targetUserId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnection.ontrack = (event) => {
        console.log('Received remote track from:', userName);
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
    
    peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE state for ${userName}: ${peerConnection.iceConnectionState}`);
    };
    
    return peerConnection;
}

function addRemoteVideo(userId, userName) {
    if (userId === socket.id) return;
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
    
    container.appendChild(video);
    container.appendChild(username);
    videoGrid.appendChild(container);
    
    // Создаем peer connection
    const peerConnection = createPeerConnection(userId, userName);
    peers.set(userId, { peer: peerConnection, name: userName });
    
    // Создаем offer
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            console.log('Sending offer to:', userName);
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

function createRoom() {
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('Please enter your name');
        return;
    }
    currentUserName = userName;
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log('Creating room:', roomId);
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
    console.log('Joining room:', roomId);
    socket.emit('join-room', roomId, userName);
}

function leaveRoom() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    peers.forEach((value) => {
        value.peer.close();
    });
    peers.clear();
    
    videoGrid.innerHTML = '';
    loginScreen.style.display = 'flex';
    chatScreen.style.display = 'none';
    
    document.getElementById('userName').value = '';
    document.getElementById('roomId').value = '';
    
    currentRoomId = null;
}

function copyRoomLink() {
    if (!currentRoomId) return;
    const link = `${window.location.origin}?room=${currentRoomId}`;
    navigator.clipboard.writeText(link);
    alert('Room link copied!');
}

function toggleAudio() {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('audioBtn');
        btn.textContent = audioTrack.enabled ? '🎤 Mute' : '🔇 Unmute';
    }
}

function toggleVideo() {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const btn = document.getElementById('videoBtn');
        btn.textContent = videoTrack.enabled ? '📹 Stop Video' : '📹 Start Video';
    }
}

async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        const oldVideoTrack = localStream.getVideoTracks()[0];
        
        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(videoTrack);
        
        const localVideo = document.querySelector(`#video-${socket.id} video`);
        if (localVideo) localVideo.srcObject = localStream;
        
        peers.forEach((value) => {
            const sender = value.peer.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
        });
        
        videoTrack.onended = () => {
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    const newVideoTrack = stream.getVideoTracks()[0];
                    localStream.removeTrack(videoTrack);
                    localStream.addTrack(newVideoTrack);
                    peers.forEach((value) => {
                        const sender = value.peer.getSenders().find(s => s.track?.kind === 'video');
                        if (sender) sender.replaceTrack(newVideoTrack);
                    });
                });
        };
    } catch (error) {
        console.error('Error sharing screen:', error);
    }
}

// Автоматическое подключение по ссылке с room параметром
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
    document.getElementById('roomId').value = roomFromUrl;
}
