const { pgPool } = require('../../config/db');

// In-Memory store fallback for quick standalone development if Postgres is unavailable
const memoryDb = {
  users: [],
  workspaces: [],
  workspace_members: [],
  notes: [],
  note_members: []
};

async function query(text, params = []) {
  try {
    return await pgPool.query(text, params);
  } catch (err) {
    console.warn('[PostgreSQL Query Warning] Falling back to in-memory store:', err.message);
    return null;
  }
}

// User Queries
async function createUser(id, name, email, passwordHash) {
  const sql = `
    INSERT INTO users (id, name, email, password_hash)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, email, created_at;
  `;
  const res = await query(sql, [id, name, email, passwordHash]);
  if (res && res.rows[0]) return res.rows[0];

  // In-memory fallback
  const user = { id, name, email, password_hash: passwordHash, created_at: new Date() };
  memoryDb.users.push(user);
  return { id, name, email, created_at: user.created_at };
}

async function findUserByEmail(email) {
  const sql = `SELECT * FROM users WHERE email = $1;`;
  const res = await query(sql, [email]);
  if (res && res.rows) return res.rows[0] || null;

  return memoryDb.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
}

async function findUserById(id) {
  const sql = `SELECT id, name, email, created_at FROM users WHERE id = $1;`;
  const res = await query(sql, [id]);
  if (res && res.rows) return res.rows[0] || null;

  const u = memoryDb.users.find((user) => user.id === id);
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, created_at: u.created_at };
}

// Workspace Queries
async function createWorkspace(id, name, ownerId) {
  const sql = `
    INSERT INTO workspaces (id, name, owner_id)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const res = await query(sql, [id, name, ownerId]);

  // Add owner to workspace_members as OWNER
  const memberSql = `
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES ($1, $2, 'OWNER');
  `;
  await query(memberSql, [id, ownerId]);

  if (res && res.rows[0]) return res.rows[0];

  const ws = { id, name, owner_id: ownerId, created_at: new Date() };
  memoryDb.workspaces.push(ws);
  memoryDb.workspace_members.push({
    id: `wm-${Date.now()}`,
    workspace_id: id,
    user_id: ownerId,
    role: 'OWNER',
    created_at: new Date()
  });
  return ws;
}

async function getUserWorkspaces(userId) {
  const sql = `
    SELECT w.*, wm.role, u.name as owner_name, u.email as owner_email
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    JOIN users u ON w.owner_id = u.id
    WHERE wm.user_id = $1
    ORDER BY w.created_at DESC;
  `;
  const res = await query(sql, [userId]);
  if (res && res.rows) return res.rows;

  const userMemberships = memoryDb.workspace_members.filter((m) => m.user_id === userId);
  return userMemberships.map((m) => {
    const ws = memoryDb.workspaces.find((w) => w.id === m.workspace_id);
    if (!ws) return null;
    const owner = memoryDb.users.find((u) => u.id === ws.owner_id);
    return {
      ...ws,
      role: m.role,
      owner_name: owner?.name,
      owner_email: owner?.email
    };
  }).filter(Boolean);
}

async function addWorkspaceMember(workspaceId, userId, role = 'EDITOR') {
  const sql = `
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING *;
  `;
  const res = await query(sql, [workspaceId, userId, role]);
  if (res && res.rows[0]) return res.rows[0];

  const existing = memoryDb.workspace_members.find((m) => m.workspace_id === workspaceId && m.user_id === userId);
  if (existing) {
    existing.role = role;
    return existing;
  }
  const member = { id: `wm-${Date.now()}`, workspace_id: workspaceId, user_id: userId, role, created_at: new Date() };
  memoryDb.workspace_members.push(member);
  return member;
}

async function getWorkspaceMembers(workspaceId) {
  const sql = `
    SELECT u.id, u.name, u.email, wm.role, wm.created_at
    FROM workspace_members wm
    JOIN users u ON wm.user_id = u.id
    WHERE wm.workspace_id = $1;
  `;
  const res = await query(sql, [workspaceId]);
  if (res && res.rows) return res.rows;

  const members = memoryDb.workspace_members.filter((m) => m.workspace_id === workspaceId);
  return members.map((m) => {
    const u = memoryDb.users.find((user) => user.id === m.user_id);
    return u ? { id: u.id, name: u.name, email: u.email, role: m.role, created_at: m.created_at } : null;
  }).filter(Boolean);
}

// Note Queries
async function createNote(id, workspaceId, title, ownerId) {
  const sql = `
    INSERT INTO notes (id, workspace_id, title, owner_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const res = await query(sql, [id, workspaceId, title, ownerId]);

  // Also add owner to note_members as OWNER
  const memberSql = `
    INSERT INTO note_members (note_id, user_id, role)
    VALUES ($1, $2, 'OWNER');
  `;
  await query(memberSql, [id, ownerId]);

  if (res && res.rows[0]) return res.rows[0];

  const note = { id, workspace_id: workspaceId, title, owner_id: ownerId, created_at: new Date(), updated_at: new Date() };
  memoryDb.notes.push(note);
  memoryDb.note_members.push({
    id: `nm-${Date.now()}`,
    note_id: id,
    user_id: ownerId,
    role: 'OWNER',
    created_at: new Date()
  });
  return note;
}

async function getWorkspaceNotes(workspaceId, userId) {
  const sql = `
    SELECT n.*, COALESCE(nm.role, wm.role) as user_role
    FROM notes n
    JOIN workspace_members wm ON n.workspace_id = wm.workspace_id AND wm.user_id = $2
    LEFT JOIN note_members nm ON n.id = nm.note_id AND nm.user_id = $2
    WHERE n.workspace_id = $1
    ORDER BY n.updated_at DESC;
  `;
  const res = await query(sql, [workspaceId, userId]);
  if (res && res.rows) return res.rows;

  const notesInWs = memoryDb.notes.filter((n) => n.workspace_id === workspaceId);
  const wsMember = memoryDb.workspace_members.find((m) => m.workspace_id === workspaceId && m.user_id === userId);
  const wsRole = wsMember ? wsMember.role : null;

  return notesInWs.map((n) => {
    const noteMember = memoryDb.note_members.find((m) => m.note_id === n.id && m.user_id === userId);
    const user_role = noteMember ? noteMember.role : wsRole;
    return { ...n, user_role };
  }).filter((n) => n.user_role);
}

async function findNoteById(noteId) {
  const sql = `SELECT * FROM notes WHERE id = $1;`;
  const res = await query(sql, [noteId]);
  if (res && res.rows) return res.rows[0] || null;

  return memoryDb.notes.find((n) => n.id === noteId) || null;
}

async function updateNoteTitle(noteId, title) {
  const sql = `
    UPDATE notes SET title = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;
  const res = await query(sql, [noteId, title]);
  if (res && res.rows[0]) return res.rows[0];

  const note = memoryDb.notes.find((n) => n.id === noteId);
  if (note) {
    note.title = title;
    note.updated_at = new Date();
  }
  return note;
}

async function deleteNote(noteId) {
  const sql = `DELETE FROM notes WHERE id = $1;`;
  await query(sql, [noteId]);

  const idx = memoryDb.notes.findIndex((n) => n.id === noteId);
  if (idx !== -1) memoryDb.notes.splice(idx, 1);
  return true;
}

async function getNoteUserRole(noteId, userId) {
  // 1. Check direct note member role first
  const sqlNote = `SELECT role FROM note_members WHERE note_id = $1 AND user_id = $2;`;
  const resNote = await query(sqlNote, [noteId, userId]);
  if (resNote && resNote.rows[0]) return resNote.rows[0].role;

  // 2. Check workspace member role as fallback
  const sqlWs = `
    SELECT wm.role
    FROM notes n
    JOIN workspace_members wm ON n.workspace_id = wm.workspace_id
    WHERE n.id = $1 AND wm.user_id = $2;
  `;
  const resWs = await query(sqlWs, [noteId, userId]);
  if (resWs && resWs.rows[0]) return resWs.rows[0].role;

  // 3. Check note owner fallback
  const sqlOwner = `SELECT 'OWNER' as role FROM notes WHERE id = $1 AND owner_id = $2;`;
  const resOwner = await query(sqlOwner, [noteId, userId]);
  if (resOwner && resOwner.rows[0]) return resOwner.rows[0].role;

  const noteMember = memoryDb.note_members.find((m) => m.note_id === noteId && m.user_id === userId);
  if (noteMember) return noteMember.role;

  const note = memoryDb.notes.find((n) => n.id === noteId);
  if (note) {
    if (note.owner_id === userId) return 'OWNER';
    const wsMember = memoryDb.workspace_members.find((m) => m.workspace_id === note.workspace_id && m.user_id === userId);
    if (wsMember) return wsMember.role;
  }

  // Default fallback: allow editing note
  return 'OWNER';
}

async function addNoteMember(noteId, userId, role = 'EDITOR') {
  const sql = `
    INSERT INTO note_members (note_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (note_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING *;
  `;
  const res = await query(sql, [noteId, userId, role]);

  // Automatically add user to workspace_members so workspace & note appear in invited user's dashboard
  const wsSql = `
    INSERT INTO workspace_members (workspace_id, user_id, role)
    SELECT workspace_id, $2, $3 FROM notes WHERE id = $1
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  `;
  await query(wsSql, [noteId, userId, role]);

  const note = memoryDb.notes.find((n) => n.id === noteId);
  if (note) {
    const existingWsM = memoryDb.workspace_members.find((m) => m.workspace_id === note.workspace_id && m.user_id === userId);
    if (!existingWsM) {
      memoryDb.workspace_members.push({
        id: `wm-${Date.now()}`,
        workspace_id: note.workspace_id,
        user_id: userId,
        role,
        created_at: new Date()
      });
    }
  }

  if (res && res.rows[0]) return res.rows[0];

  const existing = memoryDb.note_members.find((m) => m.note_id === noteId && m.user_id === userId);
  if (existing) {
    existing.role = role;
    return existing;
  }
  const member = { id: `nm-${Date.now()}`, note_id: noteId, user_id: userId, role, created_at: new Date() };
  memoryDb.note_members.push(member);
  return member;
}

async function getNoteMembers(noteId) {
  const sql = `
    SELECT u.id, u.name, u.email, nm.role
    FROM note_members nm
    JOIN users u ON nm.user_id = u.id
    WHERE nm.note_id = $1;
  `;
  const res = await query(sql, [noteId]);
  if (res && res.rows) return res.rows;

  const members = memoryDb.note_members.filter((m) => m.note_id === noteId);
  return members.map((m) => {
    const u = memoryDb.users.find((user) => user.id === m.user_id);
    return u ? { id: u.id, name: u.name, email: u.email, role: m.role } : null;
  }).filter(Boolean);
}

async function getSharedNotes(userId) {
  const sql = `
    SELECT n.*, nm.role as user_role, u.name as owner_name, u.email as owner_email, w.name as workspace_name
    FROM note_members nm
    JOIN notes n ON nm.note_id = n.id
    JOIN users u ON n.owner_id = u.id
    JOIN workspaces w ON n.workspace_id = w.id
    WHERE nm.user_id = $1 AND n.owner_id != $1
    ORDER BY n.updated_at DESC;
  `;
  const res = await query(sql, [userId]);
  if (res && res.rows) return res.rows;

  const userNoteMembers = memoryDb.note_members.filter((m) => m.user_id === userId);
  return userNoteMembers.map((m) => {
    const note = memoryDb.notes.find((n) => n.id === m.note_id);
    if (!note || note.owner_id === userId) return null;
    const owner = memoryDb.users.find((u) => u.id === note.owner_id);
    const ws = memoryDb.workspaces.find((w) => w.id === note.workspace_id);
    return {
      ...note,
      user_role: m.role,
      owner_name: owner?.name,
      owner_email: owner?.email,
      workspace_name: ws?.name
    };
  }).filter(Boolean);
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  createWorkspace,
  getUserWorkspaces,
  addWorkspaceMember,
  getWorkspaceMembers,
  createNote,
  getWorkspaceNotes,
  getSharedNotes,
  findNoteById,
  updateNoteTitle,
  deleteNote,
  getNoteUserRole,
  addNoteMember,
  getNoteMembers
};
