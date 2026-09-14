const express = require('express');
const { randomUUID } = require('crypto');
const {
  createNote,
  getWorkspaceNotes,
  getSharedNotes,
  findNoteById,
  updateNoteTitle,
  deleteNote,
  addNoteMember,
  getNoteMembers,
  findUserByEmail,
  getNoteUserRole
} = require('../models/postgres/db');
const { authMiddleware } = require('../middleware/auth');
const { requireNoteRole } = require('../middleware/rbac');
const {
  getOrCreateDocument,
  getNoteHistory,
  getDocumentAtVersion,
  restoreVersion
} = require('../services/otService');

const router = express.Router();
router.use(authMiddleware);

// POST /api/notes (Create note in workspace)
router.post('/', async (req, res) => {
  try {
    const { workspaceId, title } = req.body;
    if (!workspaceId || !title) {
      return res.status(400).json({ error: 'workspaceId and title are required.' });
    }

    const noteId = randomUUID();
    const note = await createNote(noteId, workspaceId, title.trim(), req.user.userId);
    const doc = await getOrCreateDocument(noteId, `# ${title}\n\nStart typing here...`);

    return res.status(201).json({
      note,
      document: doc
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create note: ' + err.message });
  }
});

// GET /api/notes/workspace/:workspaceId (List notes in workspace)
router.get('/workspace/:workspaceId', async (req, res) => {
  try {
    const notes = await getWorkspaceNotes(req.params.workspaceId, req.user.userId);
    return res.json({ notes });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list workspace notes: ' + err.message });
  }
});

// GET /api/notes/shared (List all notes shared with user across all workspaces)
router.get('/shared', async (req, res) => {
  try {
    const sharedNotes = await getSharedNotes(req.user.userId);
    return res.json({ sharedNotes });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list shared notes: ' + err.message });
  }
});

// GET /api/notes/:id (Open note & document state)
router.get('/:id', requireNoteRole(['OWNER', 'EDITOR', 'VIEWER']), async (req, res) => {
  try {
    const doc = await getOrCreateDocument(req.params.id);
    const members = await getNoteMembers(req.params.id);
    return res.json({
      note: req.note,
      role: req.noteRole,
      document: doc,
      members
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch note: ' + err.message });
  }
});

// PATCH /api/notes/:id (Rename note)
router.patch('/:id', requireNoteRole(['OWNER', 'EDITOR']), async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    const updatedNote = await updateNoteTitle(req.params.id, title.trim());
    return res.json({ note: updatedNote });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to rename note: ' + err.message });
  }
});

// DELETE /api/notes/:id (Delete note - OWNER only)
router.delete('/:id', requireNoteRole(['OWNER']), async (req, res) => {
  try {
    await deleteNote(req.params.id);
    return res.json({ message: 'Note deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete note: ' + err.message });
  }
});

// POST /api/notes/:id/members (Invite/Share note - OWNER only)
router.post('/:id/members', requireNoteRole(['OWNER']), async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const memberRole = ['OWNER', 'EDITOR', 'VIEWER'].includes(role) ? role : 'EDITOR';
    const member = await addNoteMember(req.params.id, user.id, memberRole);

    // Broadcast real-time invitation notification to invited user's socket room
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${user.id}`).emit('note:invited', {
        noteId: req.note.id,
        noteTitle: req.note.title,
        workspaceId: req.note.workspace_id,
        role: memberRole,
        inviterName: req.user.name || 'A collaborator',
        inviterEmail: req.user.email
      });
    }

    return res.json({ message: 'Note shared successfully', member });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to share note: ' + err.message });
  }
});

// GET /api/notes/:id/members
router.get('/:id/members', requireNoteRole(['OWNER', 'EDITOR', 'VIEWER']), async (req, res) => {
  try {
    const members = await getNoteMembers(req.params.id);
    return res.json({ members });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch note members: ' + err.message });
  }
});

// GET /api/notes/:id/history (Get version history)
router.get('/:id/history', requireNoteRole(['OWNER', 'EDITOR', 'VIEWER']), async (req, res) => {
  try {
    const history = await getNoteHistory(req.params.id);
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch note history: ' + err.message });
  }
});

// GET /api/notes/:id/versions/:version (Get preview of document state at version)
router.get('/:id/versions/:version', requireNoteRole(['OWNER', 'EDITOR', 'VIEWER']), async (req, res) => {
  try {
    const targetVer = parseInt(req.params.version, 10);
    const docState = await getDocumentAtVersion(req.params.id, targetVer);
    return res.json({ versionState: docState });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch version preview: ' + err.message });
  }
});

// POST /api/notes/:id/restore/:version (Restore a version)
router.post('/:id/restore/:version', requireNoteRole(['OWNER', 'EDITOR']), async (req, res) => {
  try {
    const targetVer = parseInt(req.params.version, 10);
    const restoredResult = await restoreVersion(
      req.params.id,
      targetVer,
      req.user.userId,
      req.user.name
    );
    return res.json({ message: `Note restored to version ${targetVer}`, restoredResult });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to restore version: ' + err.message });
  }
});

module.exports = router;
