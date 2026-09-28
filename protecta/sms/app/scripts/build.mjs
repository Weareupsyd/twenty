import { appBuild } from 'twenty-sdk/cli';
import { fileURLToPath } from 'node:url';
const appPath = fileURLToPath(new URL('../', import.meta.url));
const result = await appBuild({ appPath, onProgress: console.log });
if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}
console.log(`Built ${result.data.fileCount} files in ${result.data.outputDir}`);
