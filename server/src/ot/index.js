const Operation = require('./Operation');
const InsertOperation = require('./InsertOperation');
const DeleteOperation = require('./DeleteOperation');
const transform = require('./transform');
const compose = require('./compose');
const apply = require('./apply');
const validate = require('./validate');

module.exports = {
  Operation,
  InsertOperation,
  DeleteOperation,
  transform,
  compose,
  apply,
  validate
};
