// Package sizes are shared by the server and the browser. Prices are not:
// they live only in pricing.ts on the server.

export const PACKAGE_SIZES = [1, 3, 5, 10, 20] as const;
export type PackageSize = (typeof PACKAGE_SIZES)[number];
export const RECOMMENDED_PACKAGE: PackageSize = 5;

export function isPackageSize(value: unknown): value is PackageSize {
  return typeof value === "number" && (PACKAGE_SIZES as readonly number[]).includes(value);
}
