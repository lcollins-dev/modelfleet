import { Injectable } from '@nestjs/common';
import { resolve, sep } from 'node:path';

import { DOWNLOAD_PARTIAL_SUFFIX, DesiredDownload, DesiredDownloadFile } from '@libs/agent-protocol';

import { ContainedPaths } from '../common/contained-paths';
import { ConfigService } from '../config/config.service';
import { DownloadError } from './types/errors';
import { IFileLocation } from './types/file-location';

@Injectable()
export class DownloadLocationService {
  constructor(private readonly configService: ConfigService) {}

  /** The first directory as configured, not as the scanner sorts them. */
  modelDirectory(): string {
    const modelDirs = this.configService.modelDirs;

    if (modelDirs.length === 0) {
      throw new DownloadError('This node has no model directory configured to download into');
    }

    return modelDirs[0];
  }

  fileLocation(download: DesiredDownload, file: DesiredDownloadFile): IFileLocation {
    const modelDirectory = resolve(this.modelDirectory());
    const filePath = resolve(modelDirectory, download.directory, file.path);

    if (!filePath.startsWith(modelDirectory + sep)) {
      throw new DownloadError(`${download.directory}/${file.path} would land outside ${modelDirectory}`);
    }

    return { modelDirectory, filePath, partialPath: `${filePath}${DOWNLOAD_PARTIAL_SUFFIX}` };
  }

  /** Refuses a file whose name, or partial's name, a symlink carries out of the model directory. */
  async checkContained(location: IFileLocation): Promise<void> {
    const modelDirectory = this.modelDirectory();

    for (const path of [location.filePath, location.partialPath]) {
      if (!(await this.isContained(path))) {
        throw new DownloadError(`${path} leads outside ${modelDirectory} through a symlink`);
      }
    }
  }

  /** False as well where the path cannot be read, so nothing is written or removed through it. */
  async isContained(path: string): Promise<boolean> {
    const contained = new ContainedPaths([this.modelDirectory()]);

    try {
      return await contained.contains(await contained.realpathOfNew(path));
    } catch {
      return false;
    }
  }
}
