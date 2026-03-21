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
  }
});

app.use(cors());
app.use(express.static('public'));

// Хранилище комнат
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Создание комнаты
  socket.on('create-room', (roomId, userName) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    // Сохраняем информацию о пользователе
    socket.roomId = roomId;
    socket.userName = userName;
    
    console.log(`Room ${roomId} created by ${userName}`);
    socket.emit('room-created', roomId);
    
    // Отправляем список участников
    const participants = Array.from(rooms.get(roomId)).map(id => ({
      id: id,
      name: id === socket.id ? userName : `User_${id.slice(-4)}`
    }));
    socket.emit('participants-list', participants);
  });

  // Присоединение к комнате
  socket.on('join-room', (roomId, userName) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    
    socket.join(roomId);
    rooms.get(roomId).add(socket.id);
    socket.roomId = roomId;
    socket.userName = userName;
    
    console.log(`${userName} joined room ${roomId}`);
    
    // Уведомляем всех в комнате о новом участнике
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
    
    // Отправляем новому участнику список всех пользователей
    const participants = Array.from(rooms.get(roomId)).map(id => ({
      id: id,
      name: id === socket.id ? userName : getUserName(roomId, id)
    }));
    socket.emit('room-joined', { roomId, participants });
  });
  
  // WebRTC сигналинг
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      from: socket.id,
      fromName: socket.userName
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
  
  // Отключение пользователя
  socket.on('disconnect', () => {
    if (socket.roomId && rooms.has(socket.roomId)) {
      rooms.get(socket.roomId).delete(socket.id);
      
      // Уведомляем остальных участников
      socket.to(socket.roomId).emit('user-left', {
        userId: socket.id,
        userName: socket.userName
      });
      
      // Удаляем комнату, если она пуста
      if (rooms.get(socket.roomId).size === 0) {
        rooms.delete(socket.roomId);
      }
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Вспомогательная функция для получения имени пользователя
function getUserName(roomId, userId) {
  // В реальном приложении здесь можно хранить соответствие userId -> userName
  return `User_${userId.slice(-4)}`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});