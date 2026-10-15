export type Stop = {
  id: string;
  name: string;
  subtitle: string;
  x: number;
  z: number;
  description: string;
};
export function nearestStop(x: number, z: number, stops: Stop[], radius = 4) {
  return stops.find((s) => Math.hypot(x - s.x, z - s.z) <= radius) || null;
}
