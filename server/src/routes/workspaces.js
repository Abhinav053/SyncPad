const express = require('express');
const { randomUUID } = require('crypto');
const {
  createWorkspace,
  getUserWorkspaces,
  addWorkspaceMember,
  getWorkspaceMembers,
  findUserByEmail
} = require('../models/postgres/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// POST /api/workspaces
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Workspace name is required.' });
    }

    const wsId = randomUUID();
    const workspace = await createWorkspace(wsId, name.trim(), req.user.userId);
    return res.status(201).json({ workspace });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create workspace: ' + err.message });
  }
});

// GET /api/workspaces
router.get('/', async (req, res) => {
  try {
    const workspaces = await getUserWorkspaces(req.user.userId);
    return res.json({ workspaces });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list workspaces: ' + err.message });
  }
});

// POST /api/workspaces/:id/invite
router.post('/:id/invite', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'User email is required.' });
    }

    const targetUser = await findUserByEmail(email);
    if (!targetUser) {
      return res.status(404).json({ error: 'User with provided email not found.' });
    }

    const memberRole = ['OWNER', 'EDITOR', 'VIEWER'].includes(role) ? role : 'EDITOR';
    const member = await addWorkspaceMember(req.params.id, targetUser.id, memberRole);

    return res.json({ message: 'User invited to workspace', member });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to invite user: ' + err.message });
  }
});

// GET /api/workspaces/:id/members
router.get('/:id/members', async (req, res) => {
  try {
    const members = await getWorkspaceMembers(req.params.id);
    return res.json({ members });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch workspace members: ' + err.message });
  }
});

module.exports = router;
