import { SERVER_ERROR_CODES, type CommandResult } from '@/cli/types';
import { runSafe } from '@/cli/utilities/run-safe';
import {
  checkDockerRunning,
  CONTAINER_NAME,
  containerExists,
  getContainerDigest,
  getContainerEnvVar,
  getContainerPort,
  getDockerNotRunningMessage,
  getImageDigest,
  getImageForVersion,
  TEST_CONTAINER_NAME,
} from '@/cli/utilities/server/docker-container';
import { resolveServerUrl } from '@/cli/utilities/server/public-server-url';
import { execSync, spawnSync } from 'node:child_process';

export type ServerUpgradeOptions = {
  version?: string;
  test?: boolean;
  onProgress?: (message: string) => void;
};

export type ServerUpgradeResult = {
  image: string;
  imageUpdated: boolean;
  containerRecreated: boolean;
};

const innerServerUpgrade = async (
  options: ServerUpgradeOptions = {},
): Promise<CommandResult<ServerUpgradeResult>> => {
  const { version = 'latest', test: isTest, onProgress } = options;

  if (!checkDockerRunning()) {
    const retryCommand = [
      'yarn twenty docker:upgrade',
      version !== 'latest' ? version : null,
      isTest ? '--test' : null,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      success: false,
      error: {
        code: SERVER_ERROR_CODES.DOCKER_NOT_RUNNING,
        message: getDockerNotRunningMessage(retryCommand),
      },
    };
  }

  const containerName = isTest ? TEST_CONTAINER_NAME : CONTAINER_NAME;
  const image = getImageForVersion(version);
  const hasContainer = containerExists(containerName);
  const previousDigest = hasContainer
    ? getContainerDigest(containerName)
    : null;

  onProgress?.(`Pulling ${image}...`);

  const pullResult = spawnSync('docker', ['pull', image], {
    stdio: 'inherit',
  });

  if (pullResult.status !== 0) {
    return {
      success: false,
      error: {
        code: SERVER_ERROR_CODES.IMAGE_UPGRADE_FAILED,
        message: `Failed to pull image ${image}. Check that the version exists.`,
      },
    };
  }

  const pulledDigest = getImageDigest(image);
  const imageUpdated = !previousDigest || previousDigest !== pulledDigest;

  if (!hasContainer) {
    onProgress?.('Image pulled. No existing container to upgrade.');

    return {
      success: true,
      data: { image, imageUpdated, containerRecreated: false },
    };
  }

  if (!imageUpdated) {
    onProgress?.('Already up to date.');

    return {
      success: true,
      data: { image, imageUpdated: false, containerRecreated: false },
    };
  }

  const port = getContainerPort(containerName);

  // Read before the removal: a public SERVER_URL has to survive the upgrade
  // instead of falling back to localhost.
  const publishedUrl = getContainerEnvVar('SERVER_URL', containerName);
  const serverUrl = resolveServerUrl({ port, publishedUrl });

  onProgress?.('Removing existing container...');
  execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });

  const volumeData = isTest
    ? 'twenty-app-dev-test-data'
    : 'twenty-app-dev-data';
  const volumeStorage = isTest
    ? 'twenty-app-dev-test-storage'
    : 'twenty-app-dev-storage';
  const volumeClickHouse = isTest
    ? 'twenty-app-dev-test-clickhouse'
    : 'twenty-app-dev-clickhouse';

  onProgress?.('Starting container with new image...');

  const runResult = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      `${port}:${port}`,
      '-e',
      `NODE_PORT=${port}`,
      '-e',
      `SERVER_URL=${serverUrl}`,
      '-v',
      `${volumeData}:/data/postgres`,
      '-v',
      `${volumeClickHouse}:/data/clickhouse`,
      '-v',
      `${volumeStorage}:/app/packages/twenty-server/.local-storage`,
      image,
    ],
    { stdio: 'inherit' },
  );

  if (runResult.status !== 0) {
    return {
      success: false,
      error: {
        code: SERVER_ERROR_CODES.IMAGE_UPGRADE_FAILED,
        message: 'Failed to start container with new image.',
      },
    };
  }

  return {
    success: true,
    data: { image, imageUpdated: true, containerRecreated: true },
  };
};

export const serverUpgrade = (
  options?: ServerUpgradeOptions,
): Promise<CommandResult<ServerUpgradeResult>> =>
  runSafe(
    () => innerServerUpgrade(options),
    SERVER_ERROR_CODES.IMAGE_UPGRADE_FAILED,
  );
