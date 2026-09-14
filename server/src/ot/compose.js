const InsertOperation = require('./InsertOperation');
const DeleteOperation = require('./DeleteOperation');
const validate = require('./validate');

/**
 * Composes two sequential operations op1 followed by op2.
 * Returns a single operation if composable, or array [op1, op2].
 */
function compose(op1, op2) {
  if (!op1) return op2;
  if (!op2) return op1;

  const o1 = validate(op1);
  const o2 = validate(op2);

  // Consecutive Inserts
  if (o1.type === 'insert' && o2.type === 'insert') {
    if (o2.position === o1.position + o1.text.length) {
      return new InsertOperation(o1.position, o1.text + o2.text);
    }
  }

  // Consecutive Forward Deletes (Delete key)
  if (o1.type === 'delete' && o2.type === 'delete') {
    if (o2.position === o1.position) {
      return new DeleteOperation(o1.position, o1.length + o2.length);
    }
    // Consecutive Backward Deletes (Backspace key)
    if (o2.position + o2.length === o1.position) {
      return new DeleteOperation(o2.position, o1.length + o2.length);
    }
  }

  return [o1, o2];
}

module.exports = compose;
