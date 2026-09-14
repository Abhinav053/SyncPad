const InsertOperation = require('./InsertOperation');
const DeleteOperation = require('./DeleteOperation');

/**
 * Validates an operation object or instance against document constraints.
 * Returns a clean instance of InsertOperation or DeleteOperation, or throws an Error.
 */
function validate(opData, docLength = null) {
  if (!opData || typeof opData !== 'object') {
    throw new Error('Operation must be a non-null object');
  }

  let instance;
  if (opData.type === 'insert') {
    instance = new InsertOperation(opData.position, opData.text);
  } else if (opData.type === 'delete') {
    instance = new DeleteOperation(opData.position, opData.length);
  } else {
    throw new Error(`Unsupported operation type: ${opData.type}`);
  }

  if (typeof docLength === 'number') {
    if (instance.position > docLength) {
      throw new Error(`Operation position ${instance.position} exceeds document length ${docLength}`);
    }
  }

  return instance;
}

module.exports = validate;
