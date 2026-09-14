class Operation {
  constructor(type) {
    if (new.target === Operation) {
      throw new TypeError("Cannot instantiate abstract class Operation directly.");
    }
    this.type = type;
  }

  apply(doc) {
    throw new Error("Abstract method apply() must be implemented by subclass.");
  }

  toJSON() {
    return { type: this.type };
  }
}

module.exports = Operation;
