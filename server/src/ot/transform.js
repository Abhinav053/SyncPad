const InsertOperation = require('./InsertOperation');
const DeleteOperation = require('./DeleteOperation');
const validate = require('./validate');

/**
 * Transforms operation `op1` against operation `op2` assuming `op2` was applied first.
 * `prioritySide` is 'left' if op1 takes precedence over op2 on identical position insert ties, or 'right' otherwise.
 *
 * Returns a transformed Operation (or array of Operations, or null/noop DeleteOperation).
 */
function transform(op1, op2, prioritySide = 'left') {
  // Handle null / noop inputs
  if (!op1) return null;
  if (!op2) return op1;

  // Handle arrays recursively
  if (Array.isArray(op1)) {
    return op1
      .map((o1) => transform(o1, op2, prioritySide))
      .flat()
      .filter(Boolean);
  }
  if (Array.isArray(op2)) {
    return op2.reduce(
      (currOp1, o2) => transform(currOp1, o2, prioritySide),
      op1
    );
  }

  const o1 = validate(op1);
  const o2 = validate(op2);

  // 1. INSERT vs INSERT
  if (o1.type === 'insert' && o2.type === 'insert') {
    if (o1.position < o2.position) {
      return new InsertOperation(o1.position, o1.text);
    } else if (o1.position > o2.position) {
      return new InsertOperation(o1.position + o2.text.length, o1.text);
    } else {
      // o1.position === o2.position (Tie!)
      if (prioritySide === 'left') {
        return new InsertOperation(o1.position, o1.text);
      } else {
        return new InsertOperation(o1.position + o2.text.length, o1.text);
      }
    }
  }

  // 2. INSERT vs DELETE
  if (o1.type === 'insert' && o2.type === 'delete') {
    if (o1.position <= o2.position) {
      return new InsertOperation(o1.position, o1.text);
    } else if (o1.position >= o2.position + o2.length) {
      return new InsertOperation(o1.position - o2.length, o1.text);
    } else {
      // Insert position is inside deleted region
      return new InsertOperation(o2.position, o1.text);
    }
  }

  // 3. DELETE vs INSERT
  if (o1.type === 'delete' && o2.type === 'insert') {
    if (o1.position + o1.length <= o2.position) {
      return new DeleteOperation(o1.position, o1.length);
    } else if (o1.position >= o2.position) {
      return new DeleteOperation(o1.position + o2.text.length, o1.length);
    } else {
      // Insertion occurred inside the region that o1 intended to delete.
      // Split o1 around the inserted text.
      const lenBefore = o2.position - o1.position;
      const lenAfter = o1.length - lenBefore;

      const result = [];
      if (lenBefore > 0) {
        result.push(new DeleteOperation(o1.position, lenBefore));
      }
      if (lenAfter > 0) {
        result.push(new DeleteOperation(o2.position + o2.text.length, lenAfter));
      }
      return result.length === 1 ? result[0] : result;
    }
  }

  // 4. DELETE vs DELETE
  if (o1.type === 'delete' && o2.type === 'delete') {
    const end1 = o1.position + o1.length;
    const end2 = o2.position + o2.length;

    // Case A: o1 completely before o2
    if (end1 <= o2.position) {
      return new DeleteOperation(o1.position, o1.length);
    }
    // Case B: o1 completely after o2
    if (o1.position >= end2) {
      return new DeleteOperation(o1.position - o2.length, o1.length);
    }

    // Overlapping deletions
    const beforeLen = Math.max(0, o2.position - o1.position);
    const afterLen = Math.max(0, end1 - end2);

    if (beforeLen > 0 && afterLen > 0) {
      // o2 deleted text inside o1's deletion range
      return new DeleteOperation(o1.position, beforeLen + afterLen);
    } else if (beforeLen > 0) {
      return new DeleteOperation(o1.position, beforeLen);
    } else if (afterLen > 0) {
      return new DeleteOperation(o2.position, afterLen);
    } else {
      // o1's region was entirely contained inside o2's deleted region
      return new DeleteOperation(o1.position, 0);
    }
  }

  throw new Error(`Unhandled transform case for types: ${o1.type} vs ${o2.type}`);
}

module.exports = transform;
