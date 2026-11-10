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

  /**
   * The one the download names, matched exactly against this node's own list so the server cannot widen where files
   * land. A download that names none takes the first as configured, not as the scanner sorts them.
   */
  modelDirectory(download: DesiredDownload): string {
    const modelDirs = this.configService.modelDirs;

    if (download.modelDirectory === undefined) {
      if (modelDirs.length === 0) {
        throw new DownloadError('This node has no model directory configured to download into');
      }

      return modelDirs[0];
    }

    if (!modelDirs.includes(download.modelDirectory)) {
      throw new DownloadError(`Model directory ${download.modelDirectory} is not configured on this node.`);
    }

    return download.modelDirectory;
  }

  hasModelDirectory(download: DesiredDownload): boolean {
    const modelDirs = this.configService.modelDirs;

    return download.modelDirectory === undefined ? modelDirs.length > 0 : modelDirs.includes(download.modelDirectory);
  }

  modelDirectories(): string[] {
    return [...new Set(this.configService.modelDirs.map(modelDirectory => resolve(modelDirectory)))];
  }

  fileLocation(download: DesiredDownload, file: DesiredDownloadFile): IFileLocation {
    const modelDirectory = resolve(this.modelDirectory(download));
    const filePath = resolve(modelDirectory, download.directory, file.path);

    if (!filePath.startsWith(modelDirectory + sep)) {
      throw new DownloadError(`${download.directory}/${file.path} would land outside ${modelDirectory}`);
    }

    return { modelDirectory, filePath, partialPath: `${filePath}${DOWNLOAD_PARTIAL_SUFFIX}` };
  }

  /** Refuses a file whose name, or partial's name, a symlink carries out of the model directory. */
  async checkContained(location: IFileLocation): Promise<void> {
    for (const path of [location.filePath, location.partialPath]) {
      if (!(await this.isContained(location.modelDirectory, path))) {
        throw new DownloadError(`${path} leads outside ${location.modelDirectory} through a symlink`);
      }
    }
  }

  /** False as well where the path cannot be read, so nothing is written or removed through it. */
  async isContained(modelDirectory: string, path: string): Promise<boolean> {
    const contained = new ContainedPaths([modelDirectory]);

    try {
      return await contained.contains(await contained.realpathOfNew(path));
    } catch {
      return false;
    }
  }
}
