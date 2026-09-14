const validate = require('./validate');

/**
 * Applies an operation (or array of operations) to a string document.
 * Returns the modified string document.
 */
function apply(doc, op) {
  if (typeof doc !== 'string') {
    throw new Error('Initial document must be a string');
  }

  if (Array.isArray(op)) {
    return op.reduce((currDoc, singleOp) => apply(currDoc, singleOp), doc);
  }

  if (!op) return doc;

  const validOp = validate(op, doc.length);
  return validOp.apply(doc);
}

module.exports = apply;
