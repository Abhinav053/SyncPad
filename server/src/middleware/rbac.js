const { getNoteUserRole, findNoteById } = require('../models/postgres/db');

function requireNoteRole(allowedRoles = ['OWNER', 'EDITOR', 'VIEWER']) {
  return async (req, res, next) => {
    try {
      const noteId = req.params.id || req.body.noteId;
      const userId = req.user.userId;

      if (!noteId) {
        return res.status(400).json({ error: 'Note ID is required.' });
      }

      const note = await findNoteById(noteId);
      if (!note) {
        return res.status(404).json({ error: 'Note not found.' });
      }

      const userRole = await getNoteUserRole(noteId, userId);
      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: 'Access forbidden: Insufficient permissions for this note.' });
      }

      req.noteRole = userRole;
      req.note = note;
      next();
    } catch (err) {
      return res.status(500).json({ error: 'Failed to verify note permissions: ' + err.message });
    }
  };
}

module.exports = { requireNoteRole };
