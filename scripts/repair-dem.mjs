// Korea has no below-sea-level terrain in these scenes. Fill invalid inland
// water samples from valid neighbours; coastal bathymetry is rendered at sea level.
export function repairDEM(heights, size, id) {
  const sea = ["seongsan", "busan", "suncheon"].includes(id);
  let values = heights.map((h) => (h < 0 ? (sea ? 0 : NaN) : h));
  for (
    let pass = 0;
    values.some((v) => !Number.isFinite(v)) && pass < size;
    pass++
  ) {
    const next = [...values];
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++)
        if (!Number.isFinite(values[j * size + i])) {
          const neighbours = [];
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
              const x = i + dx,
                z = j + dz;
              if (
                x >= 0 &&
                z >= 0 &&
                x < size &&
                z < size &&
                Number.isFinite(values[z * size + x])
              )
                neighbours.push(values[z * size + x]);
            }
          if (neighbours.length) {
            neighbours.sort((a, b) => a - b);
            next[j * size + i] = neighbours[Math.floor(neighbours.length / 2)];
          }
        }
    values = next;
  }
  return values.map((v) => (Number.isFinite(v) ? v : 0));
}
