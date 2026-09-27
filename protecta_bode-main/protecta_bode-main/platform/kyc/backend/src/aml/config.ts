export const amlConfig = {
  yenteUrl: (process.env.YENTE_URL || 'http://yente:9000').replace(/\/$/, ''),
  yenteDataset: process.env.YENTE_DATASET || 'default',
  yenteUpdateToken: process.env.YENTE_UPDATE_TOKEN || '',
  apiKeyRead: process.env.API_KEY_READ || '',
  apiKeyAdmin: process.env.API_KEY_ADMIN || '',
  defaultThreshold: Number(process.env.DEFAULT_THRESHOLD || 0.82),
  staleHours: Number(process.env.STALE_DATA_THRESHOLD_HOURS || 48),
  dataDir: process.env.OPENSANCTIONS_DATA_DIR || '/data/opensanctions',
};

export const SCHEMA_MAPPING: Record<string, string[]> = {
  person: ['Person'],
  company: ['Company', 'LegalEntity'],
  organization: ['Organization', 'LegalEntity'],
  vessel: ['Vessel'],
  aircraft: ['Airplane'],
  auto: ['Person', 'Company', 'Organization', 'LegalEntity', 'Vessel', 'Airplane'],
};
