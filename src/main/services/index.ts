import { accountManager } from './account-manager';
import { csgoResolver } from './csgoapi-resolver.service';
import { bindInventorySync } from './inventory-sync.service';

export { accountManager, csgoResolver, bindInventorySync };

/** Initialize all services */
export function initServices(): void {
  // Load csgoapi data
  const loaded = csgoResolver.load();
  console.log(`[Services] CsgoResolver loaded: ${loaded}`);
}
