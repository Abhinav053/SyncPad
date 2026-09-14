const Operation = require('./Operation');

class DeleteOperation extends Operation {
  constructor(position, length) {
    super('delete');
    if (typeof position !== 'number' || position < 0 || !Number.isInteger(position)) {
      throw new Error(`Invalid position for DeleteOperation: ${position}`);
    }
    if (typeof length !== 'number' || length < 0 || !Number.isInteger(length)) {
      throw new Error(`Invalid length for DeleteOperation: ${length}`);
    }
    this.position = position;
    this.length = length;
  }

  apply(doc) {
    if (typeof doc !== 'string') {
      throw new Error('Document content must be a string');
    }
    if (this.position > doc.length) {
      throw new Error(`Delete position ${this.position} out of bounds for doc length ${doc.length}`);
    }
    const endPos = Math.min(doc.length, this.position + this.length);
    return doc.slice(0, this.position) + doc.slice(endPos);
  }

  toJSON() {
    return {
      type: 'delete',
      position: this.position,
      length: this.length
    };
  }
}

module.exports = DeleteOperation;
