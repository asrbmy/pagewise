// Test environment: jsdom + an in-memory IndexedDB implementation.
import 'fake-indexeddb/auto';

// ProseMirror measures layout when scrolling selections into view; jsdom has no layout engine.
const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!document.elementFromPoint) document.elementFromPoint = () => null;
