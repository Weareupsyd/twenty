const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * Trim, drop trailing slashes and require an http(s) URL. Anything else is
 * unusable as a published base URL, so it is reported as absent rather than
 * passed on to the container.
 */
const normalizeServerUrl = (value: string | null | undefined): string | null => {
  const candidate = (value ?? '').trim().replace(/\/+$/, '');

  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);

    return url.protocol === 'http:' || url.protocol === 'https:'
      ? candidate
      : null;
  } catch {
    return null;
  }
};

/** Whether a published URL can only be reached from the server machine. */
export const isLoopbackServerUrl = (value: string | null | undefined): boolean => {
  const normalized = normalizeServerUrl(value);

  if (!normalized) {
    return false;
  }

  return LOOPBACK_HOSTNAMES.includes(new URL(normalized).hostname);
};

/**
 * The URL a Twenty container publishes itself as (`SERVER_URL`). The server
 * builds absolute URLs from it — OAuth redirects, emails, asset links and the
 * config injected into the front-end — so a deployment reached by IP or domain
 * must not keep the localhost default: browsers on other machines would then
 * call `http://localhost:<port>/rest/...` and fail.
 *
 * Resolution order:
 * 1. `SERVER_URL` in the CLI's environment, which is how a deployment script
 *    states its public URL;
 * 2. the URL an existing container already runs with, when it is not a
 *    loopback one, so an image upgrade does not silently revert a public
 *    deployment to localhost;
 * 3. `http://localhost:<port>`, which keeps local development unchanged.
 */
export const resolveServerUrl = ({
  port,
  publishedUrl,
  env = process.env,
}: {
  port: number;
  publishedUrl?: string | null;
  env?: Record<string, string | undefined>;
}): string => {
  const requested = normalizeServerUrl(env.SERVER_URL);

  if (requested) {
    return requested;
  }

  const running = normalizeServerUrl(publishedUrl);

  if (running && !isLoopbackServerUrl(running)) {
    return running;
  }

  return `http://localhost:${port}`;
};
