const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Храним пользователей по комнатам
const rooms = {};

io.on('connection', (socket) => {
  console.log('🔌 Пользователь подключился:', socket.id);

  // Вход в комнату
  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;

    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }
    rooms[roomId].push({ id: socket.id, name: userName });

    // Сообщаем другим в комнате о новом участнике
    socket.to(roomId).emit('user-joined', { id: socket.id, name: userName });

    // Отправляем список участников новому пользователю
    socket.emit('room-users', rooms[roomId].filter(u => u.id !== socket.id));

    console.log(`📍 ${userName} зашёл в комнату ${roomId}`);
  });

  // WebRTC Offer
  socket.on('offer', ({ targetId, offer }) => {
    socket.to(targetId).emit('offer', { 
      senderId: socket.id, 
      offer 
    });
  });

  // WebRTC Answer
  socket.on('answer', ({ targetId, answer }) => {
    socket.to(targetId).emit('answer', { 
      senderId: socket.id, 
      answer 
    });
  });

  // ICE Candidate
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    socket.to(targetId).emit('ice-candidate', { 
      senderId: socket.id, 
      candidate 
    });
  });

  // Выход из комнаты
  socket.on('disconnect', () => {
    if (socket.roomId && rooms[socket.roomId]) {
      rooms[socket.roomId] = rooms[socket.roomId].filter(u => u.id !== socket.id);
      socket.to(socket.roomId).emit('user-left', { id: socket.id });
      
      if (rooms[socket.roomId].length === 0) {
        delete rooms[socket.roomId];
      }
    }
    console.log('❌ Пользователь отключился:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
