// Known places for the location picker: [name, lat (°N), lon (°E)].
const CITIES = [
  // North America
  ['Anchorage', 61.22, -149.90], ['Atlanta', 33.75, -84.39], ['Austin', 30.27, -97.74],
  ['Boston', 42.36, -71.06], ['Calgary', 51.05, -114.07], ['Chicago', 41.88, -87.63],
  ['Dallas', 32.78, -96.80], ['Denver', 39.74, -104.99], ['Honolulu', 21.31, -157.86],
  ['Houston', 29.76, -95.37], ['Las Vegas', 36.17, -115.14], ['Los Angeles', 34.05, -118.24],
  ['Mexico City', 19.43, -99.13], ['Miami', 25.76, -80.19], ['Minneapolis', 44.98, -93.27],
  ['Montreal', 45.50, -73.57], ['New Orleans', 29.95, -90.07], ['New York', 40.71, -74.01],
  ['Philadelphia', 39.95, -75.17], ['Phoenix', 33.45, -112.07], ['Portland', 45.52, -122.68],
  ['Salt Lake City', 40.76, -111.89], ['San Diego', 32.72, -117.16], ['San Francisco', 37.77, -122.42],
  ['Seattle', 47.61, -122.33], ['Toronto', 43.65, -79.38], ['Vancouver', 49.28, -123.12],
  ['Washington, D.C.', 38.91, -77.04],
  // South America
  ['Bogotá', 4.71, -74.07], ['Buenos Aires', -34.60, -58.38], ['Lima', -12.05, -77.04],
  ['Rio de Janeiro', -22.91, -43.17], ['Santiago', -33.45, -70.67], ['São Paulo', -23.55, -46.63],
  // Europe
  ['Amsterdam', 52.37, 4.90], ['Athens', 37.98, 23.73], ['Barcelona', 41.39, 2.17],
  ['Berlin', 52.52, 13.40], ['Dublin', 53.35, -6.26], ['Edinburgh', 55.95, -3.19],
  ['Greenwich', 51.48, 0.00], ['Helsinki', 60.17, 24.94], ['Istanbul', 41.01, 28.98],
  ['Lisbon', 38.72, -9.14], ['London', 51.51, -0.13], ['Madrid', 40.42, -3.70],
  ['Moscow', 55.76, 37.62], ['Oslo', 59.91, 10.75], ['Paris', 48.86, 2.35],
  ['Prague', 50.08, 14.44], ['Reykjavík', 64.15, -21.94], ['Rome', 41.90, 12.50],
  ['Stockholm', 59.33, 18.07], ['Vienna', 48.21, 16.37], ['Zurich', 47.38, 8.54],
  // Africa and the Middle East
  ['Cairo', 30.04, 31.24], ['Cape Town', -33.92, 18.42], ['Dubai', 25.20, 55.27],
  ['Jerusalem', 31.77, 35.21], ['Johannesburg', -26.20, 28.05], ['Lagos', 6.52, 3.38],
  ['Marrakesh', 31.63, -8.01], ['Nairobi', -1.29, 36.82],
  // Asia
  ['Bangkok', 13.76, 100.50], ['Beijing', 39.90, 116.41], ['Delhi', 28.61, 77.21],
  ['Hong Kong', 22.32, 114.17], ['Jakarta', -6.21, 106.85], ['Kathmandu', 27.72, 85.32],
  ['Manila', 14.60, 120.98], ['Mumbai', 19.08, 72.88], ['Seoul', 37.57, 126.98],
  ['Shanghai', 31.23, 121.47], ['Singapore', 1.35, 103.82], ['Taipei', 25.03, 121.57],
  ['Tokyo', 35.68, 139.69],
  // Oceania and Antarctica
  ['Auckland', -36.85, 174.76], ['Brisbane', -27.47, 153.03], ['McMurdo Station', -77.85, 166.67],
  ['Melbourne', -37.81, 144.96], ['Perth', -31.95, 115.86], ['Sydney', -33.87, 151.21],
  // Observatories
  ['Mauna Kea', 19.82, -155.47], ['Atacama (ALMA)', -23.02, -67.75], ['La Palma', 28.76, -17.89],
];
