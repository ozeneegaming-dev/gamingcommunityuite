// jsdom nu are API-urile de layout pe care ProseMirror (editorul) le cheamă; le simulăm cu valori goale.
const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;

if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect = () => emptyRect;
  Range.prototype.getClientRects = () => emptyList;
}
if (typeof Element !== "undefined") {
  Element.prototype.getClientRects = () => emptyList;
  Element.prototype.scrollIntoView = () => {};
}
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
