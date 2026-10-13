// The sample floor plan used by the setup guide: an electric motor plant drawing,
// 2000 x 1183 px, whose outer walls (at x = 25 px and x = 1970 px) are 160 m apart.
export const SAMPLE_PLAN = {
  name: 'sample-motor-plant.webp',
  image: 'samples/reference-plan.webp',
  width: 2000,
  height: 1183,
  wallLeft: 25,
  wallRight: 1970,
  wallY: 640, // a row where both outer walls are easy to click (the main aisle)
  realWidth: 160,
};

// Zones traced from the drawing: [name, kind, x0, y0, x1, y1] in drawing pixels
export const SAMPLE_ZONES = [
  ['Stator & coil shop', 'secondary', 345, 310, 705, 600],
  ['Assembly hall', 'assembly', 745, 315, 1915, 600],
  ['Machining cells', 'production', 755, 30, 1275, 285],
  ['Castings warehouse', 'warehouse', 1660, 30, 1965, 285],
  ['Finished goods', 'storage', 330, 655, 890, 1055],
  ['Receiving', 'dock', 30, 655, 160, 1055],
  ['Canteen', 'break', 895, 860, 1125, 1055],
  ['Shipping warehouse', 'storage', 1295, 655, 1730, 1055],
  ['Office & QC lab', 'office', 30, 35, 160, 260],
  ['Utilities', 'utility', 30, 310, 300, 595],
];
