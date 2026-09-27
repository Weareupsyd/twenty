import cron from 'node-cron';
import { logger } from '@/utils/logger.js';
import { triggerReindex } from './datasets.js';

/** Daily 01:00 UTC: download entities.ftm.json + yente /updatez. */
export function startAmlJobs(): void {
  cron.schedule('0 1 * * *', async () => {
    logger.info('AML: daily OpenSanctions file sync + yente reindex');
    try {
      const result = await triggerReindex();
      logger.info('AML: daily sync result', result);
    } catch (err) {
      logger.error('AML: daily sync failed', { error: err });
    }
  });
  logger.info('AML: dataset sync scheduled (0 1 * * * UTC)');
}
