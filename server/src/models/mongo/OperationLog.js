const mongoose = require('mongoose');

const operationLogSchema = new mongoose.Schema({
  noteId: {
    type: String,
    required: true
  },
  version: {
    type: Number,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    default: 'Anonymous'
  },
  baseVersion: {
    type: Number,
    required: true
  },
  operation: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

operationLogSchema.index({ noteId: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('OperationLog', operationLogSchema);
