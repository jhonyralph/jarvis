// Status-colored tray icons (18×18 RGBA circles), embedded as PNG data URLs so the tray shows
// green/yellow/red WITHOUT a build-time render step (Electron can't render offscreen on every host).
// tray.js turns these into nativeImages. Generated once via zlib; see the commit for the generator.

const PNG = {
  ok: "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAfElEQVR4nK2Uyw0AIQgFLYBabIILZXKzFFuhC/cCiZrd1eg7zEXJ5PmBlJXTAnJ+6742JCuXrGxZuTnma7IjIi9uC8qccpbUDUlQe1kv2knylmwQyYEkkF50kmZIFSK7EFmI6EISEFQEOxr0smHPD/uQ0BaBNS10jBwPtgeteSS7M+q/hwAAAABJRU5ErkJggg==",
  warn: "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAfElEQVR4nK2Uyw0AIQgFLYAqrIYWqcBSvFMFXbgXSNTsrkbfYS5KJs8PJJWcFpDzW/e1wSq5qGRTyc0xX+MdEXlxW1DmlLOkbkiC2st60U6St2SDiA8kAfeikzRDqhDZhchCRBeSgKAi2NGglw17ftiHhLYIrGmhY+R4sD3Q4cGrSRJefwAAAABJRU5ErkJggg==",
  down: "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAfElEQVR4nK2Uyw0AIQgFLYBuTKiBTi3FHqiALtwLJGp2V6PvMBclk+cHknJOC8j5rfvaEOVclLMp5+aYr8mOiLy4LShzyllSNyRB7WW9aCfJW7JBJAeSQHrRSZohVYjsQmQhogtJQFAR7GjQy4Y9P+xDQlsE1rTQMXI82B4scWQDZy7dfQAAAABJRU5ErkJggg==",
};

/** PNG data URL for a status level ("ok"|"warn"|"down"). */
function dataUrl(level) {
  return "data:image/png;base64," + (PNG[level] || PNG.down);
}

module.exports = { dataUrl, PNG };
