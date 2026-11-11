/** One navigation screen owns motion. Stale owners never regain access after close. */
let owner: string | null = null;
export function getNavigationControlOwner(): string | null { return owner; }
export function acquireNavigationControl(token: string): void {
  if (!token || owner !== null) throw new Error("导航控制已经打开");
  owner = token;
}
export function releaseNavigationControl(token: string): void { if (owner === token) owner = null; }
export function hasNavigationControl(): boolean { return owner !== null; }
export function assertNavigationControl(token?: string): void {
  if (token ? token !== owner : owner !== null) throw new Error("路线导航正在控制底座，请先停止导航");
}
