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
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.static('public'));

const users = new Map();
const ROOM_ID = "MAIN_ROOM";

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // При подключении сразу добавляем в главную комнату
  socket.join(ROOM_ID);
  
  socket.on('join', (userName) => {
    console.log(`User ${userName} (${socket.id}) joined`);
    
    // Сохраняем пользователя
    users.set(socket.id, { name: userName });
    
    // Отправляем новому пользователю список всех участников
    const participants = Array.from(users.entries()).map(([id, data]) => ({
      id: id,
      name: data.name
    }));
    
    socket.emit('room-data', {
      participants: participants,
      yourId: socket.id
    });
    
    // Уведомляем всех остальных о новом пользователе
    socket.broadcast.emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
  });
  
  // WebRTC сигналинг
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      from: socket.id,
      fromName: users.get(socket.id)?.name
    });
  });
  
  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });
  
  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });
  
  // Отключение
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`User ${user.name} disconnected`);
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
  console.log(`Server running on port ${PORT}`);
});
