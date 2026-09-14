const Operation = require('./Operation');

class InsertOperation extends Operation {
  constructor(position, text) {
    super('insert');
    if (typeof position !== 'number' || position < 0 || !Number.isInteger(position)) {
      throw new Error(`Invalid position for InsertOperation: ${position}`);
    }
    if (typeof text !== 'string') {
      throw new Error(`Invalid text for InsertOperation: ${text}`);
    }
    this.position = position;
    this.text = text;
  }

  apply(doc) {
    if (typeof doc !== 'string') {
      throw new Error('Document content must be a string');
    }
    if (this.position > doc.length) {
      throw new Error(`Insert position ${this.position} out of bounds for doc length ${doc.length}`);
    }
    return doc.slice(0, this.position) + this.text + doc.slice(this.position);
  }

  toJSON() {
    return {
      type: 'insert',
      position: this.position,
      text: this.text
    };
  }
}

module.exports = InsertOperation;
