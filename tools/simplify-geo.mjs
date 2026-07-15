// Generate the lightweight country mesh used by the interactive globe.
// The full Natural Earth source remains in data/countries.geojson.
import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2] || 'data/countries.geojson';
const destination = process.argv[3] || 'data/countries-lite.geojson';
const tolerance = Number(process.argv[4] || 0.08);

function simplifyLine(points) {
  if (points.length <= 4) return points;

  const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  const input = closed ? points.slice(0, -1) : points;
  if (input.length <= 3) return points;

  const keep = new Uint8Array(input.length);
  const stack = [[0, input.length - 1]];
  const squareTolerance = tolerance * tolerance;
  keep[0] = 1;
  keep[input.length - 1] = 1;

  while (stack.length) {
    const [start, end] = stack.pop();
    const a = input[start];
    const b = input[end];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    let furthest = -1;
    let maxDistance = squareTolerance;

    for (let i = start + 1; i < end; i += 1) {
      const point = input[i];
      let position = denominator
        ? ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator
        : 0;
      position = Math.max(0, Math.min(1, position));
      const offsetX = point[0] - (a[0] + position * dx);
      const offsetY = point[1] - (a[1] + position * dy);
      const distance = offsetX * offsetX + offsetY * offsetY;
      if (distance > maxDistance) {
        maxDistance = distance;
        furthest = i;
      }
    }

    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([start, furthest], [furthest, end]);
    }
  }

  const output = input
    .filter((_, index) => keep[index])
    .map(([lng, lat]) => [Number(lng.toFixed(4)), Number(lat.toFixed(4))]);
  if (closed) output.push(output[0]);
  return output.length >= 4 ? output : points;
}

function simplifyCoordinates(coordinates) {
  if (typeof coordinates[0][0] === 'number') return simplifyLine(coordinates);
  return coordinates.map(simplifyCoordinates);
}

const sourceData = JSON.parse(await readFile(source, 'utf8'));
const output = {
  type: 'FeatureCollection',
  features: sourceData.features.map((feature) => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: feature.geometry.type,
      coordinates: simplifyCoordinates(feature.geometry.coordinates),
    },
  })),
};

await writeFile(destination, JSON.stringify(output));
