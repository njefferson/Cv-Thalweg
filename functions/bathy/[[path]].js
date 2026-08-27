/* The bathymetry proxy, mounted inside the site.
 *
 * Pages deploys this with the app, so there is no second thing to deploy
 * and no origin to paste anywhere: the app asks for /bathy/... on its own
 * origin and this forwards it. The allow-list, the refusals, the cache
 * lifetimes and the header stripping all live in worker.js — this file is
 * a mount point, not a second copy.
 */
import { handle } from '../../worker.js';

export function onRequest(context) {
  return handle(context.request, context, '/bathy');
}
