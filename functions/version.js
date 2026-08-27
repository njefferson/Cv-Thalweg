/* What is actually deployed here.
 *
 * A push is not a release. The only way to know which commit a live site
 * is serving is for the site to say so, and a static file cannot: there is
 * no build step to stamp one into. Pages hands its Functions the commit it
 * built from, so this reports that.
 *
 * It reports what it has and says when it has nothing, rather than
 * inventing a plausible answer — an endpoint that guesses at a commit is
 * worse than one that admits it does not know, because the guess is what
 * you would then trust.
 */
export function onRequest(context) {
  const env = context.env || {};
  const body = {
    app: 'thalweg',
    commit: env.CF_PAGES_COMMIT_SHA || null,
    branch: env.CF_PAGES_BRANCH || null,
    deployment: env.CF_PAGES_URL || null,
    /* Absent locally, and absent on any host that is not Pages. Saying so
       is the point. */
    source: env.CF_PAGES_COMMIT_SHA ? 'cloudflare pages' : 'unknown — not a Pages deployment, or the build variables are not exposed to functions',
    at: new Date().toISOString()
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
