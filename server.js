const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Храним пользователей по комнатам
const rooms = {};

io.on('connection', (socket) => {
  console.log('🔌 Подключился:', socket.id);

  // Вход в комнату
  socket.on('join-room', ({ roomId, userName }) => {
    // ВСЕГДА используем MAIN-ROOM
    const roomName = 'MAIN-ROOM';
    
    socket.join(roomName);
    socket.roomId = roomName;
    socket.userName = userName;
    
    if (!rooms[roomName]) {
      rooms[roomName] = [];
    }
    
    // Добавляем пользователя
    rooms[roomName].push({ 
      id: socket.id, 
      name: userName,
      joinedAt: new Date() 
    });
    
    console.log(`📍 ${userName} зашёл в ${roomName}. Всего пользователей: ${rooms[roomName].length}`);
    
    // Сообщаем другим о новом участнике
    socket.to(roomName).emit('user-joined', { 
      id: socket.id, 
      name: userName 
    });
    
    // Отправляем список участников новому пользователю (кроме него самого)
    const otherUsers = rooms[roomName].filter(u => u.id !== socket.id);
    socket.emit('room-users', otherUsers);
    
    // Отправляем всем обновлённый список
    io.to(roomName).emit('room-update', rooms[roomName]);
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
    console.log('❌ Отключился:', socket.id);
    
    if (socket.roomId && rooms[socket.roomId]) {
      rooms[socket.roomId] = rooms[socket.roomId].filter(u => u.id !== socket.id);
      
      socket.to(socket.roomId).emit('user-left', { id: socket.id });
      io.to(socket.roomId).emit('room-update', rooms[socket.roomId]);
      
      if (rooms[socket.roomId].length === 0) {
        delete rooms[socket.roomId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Общая комната: MAIN-ROOM`);
});
