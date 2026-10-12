// Small stroke icons for the tool rail and buttons
const P = {
  select: 'M5 3l13 8-6 1.5L9 19z',
  wall: 'M3 6h18M3 12h18M3 18h18M8 6v6M15 12v6M12 6v0',
  zone: 'M4 4h16v16H4z M4 9h16',
  aisle: 'M7 3l-3 18M17 3l3 18M12 4v3M12 10v3M12 16v3',
  route: 'M5 19c0-6 14-4 14-10 M5 19h0 M19 9h0 M4 19a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M17.5 7.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  connect: 'M4 12h6M14 12h6M10 9v6h4V9z M17 9l3 3-3 3',
  calibrate: 'M3 17L17 3l4 4L7 21z M7 13l2 2M10 10l2 2M13 7l2 2',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  reset: 'M4 4v6h6M20 12a8 8 0 1 1-2.3-5.7L20 9',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  import: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  save: 'M5 3h11l3 3v15H5z M8 3v6h8 M8 21v-7h8v7',
  open: 'M3 7h6l2 2h10v10H3z',
  file: 'M6 3h9l4 4v14H6z M14 3v5h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  cube: 'M12 2l9 5v10l-9 5-9-5V7z M12 12l9-5M12 12v10M12 12L3 7',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15M15 6v15',
  sample: 'M4 20V9l8-5 8 5v11 M9 20v-6h6v6',
  build: 'M3 21h18 M5 21V11l4-3v3l4-3v3l4-3v13 M17 21V4h3v17',
  chart: 'M4 20V4 M4 20h16 M8 16v-5 M12 16V8 M16 16v-3',
  close: 'M6 6l12 12M18 6L6 18',
};

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.cube} />
    </svg>
  );
}
