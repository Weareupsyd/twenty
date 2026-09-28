/** Replace `{{key}}` placeholders; unknown keys are left visible. */
export const renderTemplate = (
  body: string,
  data: Record<string, string>,
): string =>
  body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) =>
    key in data ? (data[key] ?? '') : match,
  );
