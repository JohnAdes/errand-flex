// Shared straight-line (great-circle) distance helper — previously
// reimplemented separately in pricing.service.ts and custody.service.ts,
// which had already drifted (identical trig, different unit radius) and
// meant the documented TODO of swapping in a real routing-provider distance
// matrix would need to be done in two places. custody.service.ts's GPS-radius
// check intentionally does NOT apply pricing's road-distance fudge factor —
// it's checking physical proximity to a real GPS point, not estimating a
// drivable route — so that stays a caller-side concern on top of this.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
