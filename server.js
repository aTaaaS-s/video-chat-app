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

// Хранилище комнат и пользователей
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Создание комнаты
  socket.on('create-room', (roomId, userName) => {
    console.log(`Creating room: ${roomId} by ${userName}`);
    
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    
    // Сохраняем пользователя
    rooms.get(roomId).set(socket.id, { id: socket.id, name: userName });
    users.set(socket.id, { roomId, name: userName });
    
    socket.emit('room-created', roomId);
    
    // Отправляем список участников
    const participants = Array.from(rooms.get(roomId).values()).map(p => ({
      id: p.id,
      name: p.name
    }));
    socket.emit('participants-list', participants);
    
    console.log(`Room ${roomId} created. Participants: ${participants.length}`);
  });

  // Присоединение к комнате
  socket.on('join-room', (roomId, userName) => {
    console.log(`User ${userName} (${socket.id}) joining room: ${roomId}`);
    
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    
    socket.join(roomId);
    rooms.get(roomId).set(socket.id, { id: socket.id, name: userName });
    users.set(socket.id, { roomId, name: userName });
    
    // Отправляем новому пользователю список всех участников
    const participants = Array.from(rooms.get(roomId).values()).map(p => ({
      id: p.id,
      name: p.name
    }));
    
    socket.emit('room-joined', { 
      roomId, 
      participants 
    });
    
    // Уведомляем всех остальных о новом пользователе
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
    
    console.log(`User ${userName} joined room ${roomId}. Total: ${participants.length}`);
  });
  
  // WebRTC сигналинг
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      from: socket.id,
      fromName: users.get(socket.id)?.name || 'Unknown'
    });
  });
  
  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });
  
  socket.on('ice-candidate', (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });
  
  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    const userData = users.get(socket.id);
    if (userData) {
      const { roomId, name } = userData;
      
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        
        // Уведомляем остальных участников
        socket.to(roomId).emit('user-left', {
          userId: socket.id,
          userName: name
        });
        
        // Удаляем комнату, если она пуста
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        }
      }
      
      users.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
