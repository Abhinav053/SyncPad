const { applyClientOperation, getOrCreateDocument } = require('../services/otService');
const { getNoteUserRole } = require('../models/postgres/db');

// Map of noteId -> Map(socketId -> { userId, name, email })
const notePresence = new Map();

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[Socket] User connected: ${user.name} (${user.userId}), socket=${socket.id}`);

    // Join user-specific room for real-time notifications (invitations, updates)
    if (user && user.userId) {
      socket.join(`user:${user.userId}`);
    }

    // Track rooms joined by this socket for disconnect cleanup
    const joinedRooms = new Set();

    // 1. note:join
    socket.on('note:join', async ({ noteId }, callback) => {
      try {
        if (!noteId) return;

        const role = await getNoteUserRole(noteId, user.userId);
        if (!role) {
          if (callback) callback({ error: 'Access forbidden for this note' });
          return;
        }

        const roomName = `note:${noteId}`;
        socket.join(roomName);
        joinedRooms.add(noteId);

        // Update room presence map
        if (!notePresence.has(noteId)) {
          notePresence.set(noteId, new Map());
        }
        const roomMap = notePresence.get(noteId);
        roomMap.set(socket.id, {
          userId: user.userId,
          name: user.name,
          email: user.email,
          role
        });

        // Get latest document state
        const docState = await getOrCreateDocument(noteId);

        const presenceList = Array.from(roomMap.values());

        // Broadcast user:join to others in room
        socket.to(roomName).emit('user:join', {
          userId: user.userId,
          name: user.name,
          email: user.email,
          role,
          presence: presenceList
        });

        // Send confirmation back to joiner
        if (callback) {
          callback({
            success: true,
            role,
            document: docState,
            presence: presenceList
          });
        }
      } catch (err) {
        console.error('[Socket note:join error]', err);
        if (callback) callback({ error: err.message });
      }
    });

    // 2. note:leave
    socket.on('note:leave', ({ noteId }) => {
      if (!noteId) return;
      const roomName = `note:${noteId}`;
      socket.leave(roomName);
      joinedRooms.delete(noteId);

      const roomMap = notePresence.get(noteId);
      if (roomMap) {
        roomMap.delete(socket.id);
        if (roomMap.size === 0) {
          notePresence.delete(noteId);
        } else {
          const presenceList = Array.from(roomMap.values());
          io.to(roomName).emit('user:leave', {
            userId: user.userId,
            socketId: socket.id,
            presence: presenceList
          });
        }
      }
    });

    // 3. operation:submit
    socket.on('operation:submit', async ({ noteId, baseVersion, operation }, callback) => {
      try {
        if (!noteId || baseVersion === undefined || !operation) {
          socket.emit('operation:ack', { noteId, version: baseVersion || 0 });
          if (callback) callback({ error: 'Missing required parameters for operation submission' });
          return;
        }

        // Validate role permission (OWNER or EDITOR only)
        const role = await getNoteUserRole(noteId, user.userId);
        if (role === 'VIEWER') {
          socket.emit('operation:ack', { noteId, version: baseVersion });
          if (callback) callback({ error: 'Permission denied: Viewers cannot edit notes' });
          return;
        }

        // Apply OT algorithm server-side
        const result = await applyClientOperation({
          noteId,
          baseVersion,
          operation,
          userId: user.userId,
          userName: user.name
        });

        // Acknowledge sender with new server version
        if (callback) {
          callback({
            success: true,
            version: result.version
          });
        }
        socket.emit('operation:ack', {
          noteId,
          version: result.version
        });

        // Broadcast transformed operation to other collaborators in room
        const roomName = `note:${noteId}`;
        socket.to(roomName).emit('operation:broadcast', {
          noteId,
          version: result.version,
          operation: result.operation,
          userId: user.userId
        });
      } catch (err) {
        console.error('[Socket operation:submit error]', err);
        socket.emit('operation:ack', { noteId, version: baseVersion || 0 });
        if (callback) callback({ error: err.message });
      }
    });

    // 4. user:typing & user:stopTyping
    socket.on('user:typing', ({ noteId }) => {
      if (!noteId) return;
      socket.to(`note:${noteId}`).emit('user:typing', {
        userId: user.userId,
        name: user.name
      });
    });

    socket.on('user:stopTyping', ({ noteId }) => {
      if (!noteId) return;
      socket.to(`note:${noteId}`).emit('user:stopTyping', {
        userId: user.userId
      });
    });

    // 5. cursor:update
    socket.on('cursor:update', ({ noteId, cursor }) => {
      if (!noteId || !cursor) return;
      socket.to(`note:${noteId}`).emit('cursor:update', {
        noteId,
        userId: user.userId,
        name: user.name,
        cursor
      });
    });

    // 6. disconnect
    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${user.name} (${user.userId})`);
      joinedRooms.forEach((noteId) => {
        const roomName = `note:${noteId}`;
        const roomMap = notePresence.get(noteId);
        if (roomMap) {
          roomMap.delete(socket.id);
          if (roomMap.size === 0) {
            notePresence.delete(noteId);
          } else {
            const presenceList = Array.from(roomMap.values());
            io.to(roomName).emit('user:leave', {
              userId: user.userId,
              socketId: socket.id,
              presence: presenceList
            });
          }
        }
      });
    });
  });
}

module.exports = setupSocketHandlers;
