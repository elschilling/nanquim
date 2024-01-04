"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.process = exports["default"] = exports.assign = exports.TYPE = void 0;
var _common = _interopRequireDefault(require("./common"));
var _mtext = require("./mtext");
var _text = require("./text");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }
var TYPE = 'ATTDEF';
exports.TYPE = TYPE;
var process = function process(tuples) {
  return tuples.reduce(function (entity, tuple) {
    var type = tuple[0];
    var value = tuple[1];
    assign(entity, type, value);
    return entity;
  }, {
    type: TYPE,
    subclassMarker: 'AcDbText',
    thickness: 0,
    scaleX: 1,
    mtext: {},
    text: {}
  });
};
exports.process = process;
var assign = function assign(entity, type, value) {
  switch (type) {
    case 100:
      {
        entity.subclassMarker = value;
        break;
      }
    case 1:
      switch (entity.subclassMarker) {
        case 'AcDbText':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 2:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          entity.tag = value;
          break;
        case 'AcDbXrecord':
          entity.attdefFlag = value;
          break;
      }
      break;
    case 3:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
          entity.prompt = value;
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 7:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 10:
      switch (entity.subclassMarker) {
        case 'AcDbText':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
        case 'AcDbXrecord':
          entity.x = value;
          break;
      }
      break;
    case 20:
      switch (entity.subclassMarker) {
        case 'AcDbText':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
        case 'AcDbXrecord':
          entity.y = value;
          break;
      }
      break;
    case 30:
      switch (entity.subclassMarker) {
        case 'AcDbText':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
        case 'AcDbXrecord':
          entity.z = value;
          break;
      }
      break;
    case 11:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          entity.x2 = value;
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 21:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          entity.y2 = value;
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 31:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          entity.z2 = value;
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 39:
      (0, _text.assign)(entity.text, type, value);
      break;
    case 40:
      switch (entity.subclassMarker) {
        case 'AcDbText':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
        case 'AcDbXrecord':
          entity.annotationScale = value;
          break;
      }
      break;
    case 41:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 42:
    case 43:
    case 44:
    case 45:
      (0, _mtext.assign)(entity.mtext, type, value);
      break;
    case 46:
      entity.mtext.annotationHeight = value;
      break;
    case 48:
    case 49:
      (0, _mtext.assign)(entity.mtext, type, value);
      break;
    case 50:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          {
            (0, _mtext.assign)(entity.mtext, type, value);
          }
          break;
      }
      break;
    case 51:
      (0, _text.assign)(entity.text, type, value);
      break;
    case 63:
      (0, _mtext.assign)(entity.mtext, type, value);
      break;
    case 70:
      {
        switch (entity.subclassMarker) {
          case 'AcDbAttributeDefinition':
          case 'AcDbAttribute':
            entity.attributeFlags = value;
            break;
          case 'AcDbXrecord':
            {
              if (typeof entity.mTextFlag === 'undefined') entity.mTextFlag = value;else if (typeof entity.isReallyLocked === 'undefined') entity.isReallyLocked = value;else entity.secondaryAttdefCount = value;
            }
            break;
        }
      }
      break;
    case 71:
    case 72:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          (0, _text.assign)(entity.text, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 73:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          entity.fieldLength = value;
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 74:
      (0, _text.assign)(entity.text, 73, value);
      break;
    case 75:
    case 76:
    case 78:
    case 79:
      (0, _mtext.assign)(entity.mtext, type, value);
      break;
    case 90:
      (0, _mtext.assign)(entity.mtext, type, value);
      break;
    case 210:
    case 220:
    case 230:
      switch (entity.subclassMarker) {
        case 'AcDbAttributeDefinition':
        case 'AcDbAttribute':
          (0, _text.assign)(entity.mtext, type, value);
          break;
        case 'AcDbMText':
          (0, _mtext.assign)(entity.mtext, type, value);
          break;
      }
      break;
    case 280:
      {
        switch (entity.subclassMarker) {
          case 'AcDbAttributeDefinition':
          case 'AcDbAttribute':
            entity.lock = value;
            break;
          case 'AcDbXrecord':
            entity.clone = true;
            break;
        }
      }
      break;
    case 340:
      entity.attdefHandle = value;
      break;
    case 420:
    case 421:
    case 422:
    case 423:
    case 424:
    case 425:
    case 426:
    case 427:
    case 428:
    case 429:
    case 430:
    case 431:
    case 432:
    case 433:
    case 434:
    case 435:
    case 436:
    case 437:
    case 438:
    case 439:
    case 441:
      (0, _mtext.assign)(entity.mtext, type, value);
      break;
    default:
      Object.assign(entity, (0, _common["default"])(type, value));
      break;
  }
};
exports.assign = assign;
var _default = {
  TYPE: TYPE,
  process: process,
  assign: assign
};
exports["default"] = _default;