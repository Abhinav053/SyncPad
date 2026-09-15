const mongoose = require('mongoose');
const Document = require('../models/mongo/Document');
const OperationLog = require('../models/mongo/OperationLog');
const { transform, apply, validate, InsertOperation, DeleteOperation } = require('../ot');

// In-memory fallback if MongoDB is not connected
const memoryDocs = new Map();
const memoryOps = new Map();

async function getOrCreateDocument(noteId, initialContent = '') {
  if (process.env.NODE_ENV === 'test' || mongoose.connection.readyState !== 1) {
    if (!memoryDocs.has(noteId)) {
      memoryDocs.set(noteId, { noteId, content: initialContent, initialContent, version: 0 });
      memoryOps.set(noteId, []);
    }
    return memoryDocs.get(noteId);
  }
  try {
    let doc = await Document.findOne({ noteId });
    if (!doc) {
      doc = await Document.create({ noteId, content: initialContent, version: 0 });
    }
    return { noteId: doc.noteId, content: doc.content, initialContent: doc.content, version: doc.version };
  } catch (err) {
    if (!memoryDocs.has(noteId)) {
      memoryDocs.set(noteId, { noteId, content: initialContent, initialContent, version: 0 });
      memoryOps.set(noteId, []);
    }
    return memoryDocs.get(noteId);
  }
}

async function applyClientOperation({ noteId, baseVersion, operation, userId, userName }) {
  let doc = await getOrCreateDocument(noteId);
  let currentVersion = doc.version;

  // 1. Validate incoming operation structure
  let clientOp = validate(operation, doc.content.length);

  // 2. Fetch history if baseVersion < currentVersion
  if (baseVersion < currentVersion) {
    let historyOps = [];
    if (process.env.NODE_ENV === 'test' || mongoose.connection.readyState !== 1) {
      const ops = memoryOps.get(noteId) || [];
      historyOps = ops
        .filter((o) => o.version > baseVersion && o.version <= currentVersion)
        .map((o) => o.operation);
    } else {
      try {
        const logs = await OperationLog.find({
          noteId,
          version: { $gt: baseVersion, $lte: currentVersion }
        }).sort({ version: 1 });
        historyOps = logs.map((l) => l.operation);
      } catch (err) {
        const ops = memoryOps.get(noteId) || [];
        historyOps = ops
          .filter((o) => o.version > baseVersion && o.version <= currentVersion)
          .map((o) => o.operation);
      }
    }

    // Transform incoming operation against all subsequent concurrent server operations
    for (const histOp of historyOps) {
      clientOp = transform(clientOp, histOp, 'right');
      if (!clientOp) break; // if transformed into noop
    }
  }

  // 3. Apply transformed operation to current document content
  const newContent = apply(doc.content, clientOp);
  const nextVersion = currentVersion + 1;

  // 4. Persist updated document and operation log
  if (process.env.NODE_ENV === 'test' || mongoose.connection.readyState !== 1) {
    const prevDoc = memoryDocs.get(noteId);
    const initContent = prevDoc ? prevDoc.initialContent : doc.content;
    memoryDocs.set(noteId, { noteId, content: newContent, initialContent: initContent, version: nextVersion });
    const ops = memoryOps.get(noteId) || [];
    ops.push({
      noteId,
      version: nextVersion,
      userId,
      userName: userName || 'Anonymous',
      baseVersion,
      operation: clientOp,
      createdAt: new Date()
    });
    memoryOps.set(noteId, ops);
  } else {
    try {
      await Document.updateOne(
        { noteId },
        { content: newContent, version: nextVersion, updatedAt: new Date() }
      );
      await OperationLog.create({
        noteId,
        version: nextVersion,
        userId,
        userName: userName || 'Anonymous',
        baseVersion,
        operation: clientOp
      });
    } catch (err) {
      const prevDoc = memoryDocs.get(noteId);
      const initContent = prevDoc ? prevDoc.initialContent : doc.content;
      memoryDocs.set(noteId, { noteId, content: newContent, initialContent: initContent, version: nextVersion });
      const ops = memoryOps.get(noteId) || [];
      ops.push({
        noteId,
        version: nextVersion,
        userId,
        userName: userName || 'Anonymous',
        baseVersion,
        operation: clientOp,
        createdAt: new Date()
      });
      memoryOps.set(noteId, ops);
    }
  }

  console.log(`[OT Engine] Applied op note=${noteId} user=${userId} baseVersion=${baseVersion} serverVersion=${currentVersion} -> newVersion=${nextVersion}`);

  return {
    success: true,
    noteId,
    version: nextVersion,
    operation: clientOp,
    content: newContent
  };
}

async function getNoteHistory(noteId) {
  if (process.env.NODE_ENV === 'test' || mongoose.connection.readyState !== 1) {
    const ops = memoryOps.get(noteId) || [];
    return [...ops].reverse();
  }
  try {
    const logs = await OperationLog.find({ noteId }).sort({ version: -1 });
    return logs.map((l) => ({
      version: l.version,
      userId: l.userId,
      userName: l.userName,
      baseVersion: l.baseVersion,
      operation: l.operation,
      createdAt: l.createdAt
    }));
  } catch (err) {
    const ops = memoryOps.get(noteId) || [];
    return [...ops].reverse();
  }
}

async function getDocumentAtVersion(noteId, targetVersion) {
  const initialDoc = await getOrCreateDocument(noteId);
  const baseContent = initialDoc.initialContent !== undefined ? initialDoc.initialContent : initialDoc.content;

  if (process.env.NODE_ENV === 'test' || mongoose.connection.readyState !== 1) {
    const ops = memoryOps.get(noteId) || [];
    const logs = ops.filter((o) => o.version <= targetVersion);
    let content = baseContent;
    for (const log of logs) {
      content = apply(content, log.operation);
    }
    return { version: targetVersion, content };
  }
  try {
    const logs = await OperationLog.find({
      noteId,
      version: { $lte: targetVersion }
    }).sort({ version: 1 });

    let content = baseContent;
    for (const log of logs) {
      content = apply(content, log.operation);
    }
    return { version: targetVersion, content };
  } catch (err) {
    const ops = memoryOps.get(noteId) || [];
    const logs = ops.filter((o) => o.version <= targetVersion);
    let content = baseContent;
    for (const log of logs) {
      content = apply(content, log.operation);
    }
    return { version: targetVersion, content };
  }
}

async function restoreVersion(noteId, targetVersion, userId, userName) {
  const currentDoc = await getOrCreateDocument(noteId);
  const targetState = await getDocumentAtVersion(noteId, targetVersion);

  // Non-destructive restore: replace current content with target version content via new ops
  let opResult = null;
  if (currentDoc.content.length > 0) {
    const delOp = new DeleteOperation(0, currentDoc.content.length);
    opResult = await applyClientOperation({
      noteId,
      baseVersion: currentDoc.version,
      operation: delOp,
      userId,
      userName: `${userName} (Restored v${targetVersion})`
    });
  }

  const latestDoc = await getOrCreateDocument(noteId);
  if (targetState.content.length > 0) {
    const insOp = new InsertOperation(0, targetState.content);
    opResult = await applyClientOperation({
      noteId,
      baseVersion: latestDoc.version,
      operation: insOp,
      userId,
      userName: `${userName} (Restored v${targetVersion})`
    });
  }

  return opResult || { success: true, version: latestDoc.version, content: latestDoc.content };
}

module.exports = {
  getOrCreateDocument,
  applyClientOperation,
  getNoteHistory,
  getDocumentAtVersion,
  restoreVersion
};
