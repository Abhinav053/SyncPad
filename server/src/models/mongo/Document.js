const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  noteId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  content: {
    type: String,
    default: ''
  },
  version: {
    type: Number,
    default: 0
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Document', documentSchema);
