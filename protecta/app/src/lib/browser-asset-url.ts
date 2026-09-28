/** Same-origin path so posters load on the public host, not the container's localhost. */
export const browserAssetUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
};
