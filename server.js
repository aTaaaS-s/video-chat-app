const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(cors());
app.use(express.static('public'));

// Хранилище пользователей
const users = new Map();
const ROOM_ID = "MAIN_ROOM";

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // Добавляем в главную комнату
  socket.join(ROOM_ID);
  
  socket.on('join', (userName) => {
    console.log(`👤 ${userName} (${socket.id}) joined`);
    
    users.set(socket.id, { name: userName, id: socket.id });
    
    // Отправляем новому пользователю список всех участников
    const participants = Array.from(users.values()).map(user => ({
      id: user.id,
      name: user.name
    }));
    
    socket.emit('room-data', {
      participants: participants,
      yourId: socket.id,
      yourName: userName
    });
    
    // Уведомляем всех остальных о новом пользователе
    socket.broadcast.emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
  });
  
  // WebRTC сигналинг
  socket.on('offer', (data) => {
    console.log(`📡 Offer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      from: socket.id,
      fromName: users.get(socket.id)?.name || 'Unknown'
    });
  });
  
  socket.on('answer', (data) => {
    console.log(`📡 Answer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });
  
  socket.on('ice-candidate', (data) => {
    console.log(`❄️ ICE candidate from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });
  
  // Отключение
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`❌ ${user.name} (${socket.id}) disconnected`);
      users.delete(socket.id);
      socket.broadcast.emit('user-left', {
        userId: socket.id,
        userName: user.name
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
