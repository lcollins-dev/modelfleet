import { HubApiError, listFiles, modelInfo, pathsInfo, PathInfo } from '@huggingface/hub';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

import { DOWNLOAD_REPOSITORY_PATTERN, DOWNLOAD_REVISION_PATTERN, DownloadDigestAlgorithm } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';

import { fieldRefusal } from '@/common/validation-errors';

const HUB_TIMEOUT_MS = 30_000;

/** What the Hub names in `X-Error-Code`, which tells a repository it hides apart from a revision it lacks. */
enum HubErrorCode {
  REPO_NOT_FOUND = 'RepoNotFound',
  GATED_REPO = 'GatedRepo',
}

type HubFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const MAX_LISTED_FILES = 2000;

export interface IHubFile {
  path: string;
  sizeBytes: number;
  digestAlgorithm: DownloadDigestAlgorithm;
  digest: string;
}

export interface IHubSnapshot {
  /** The repository as the Hub spells it, whatever case it was asked for in. */
  repository: string;

  revision: string;

  /** In the order they were asked for. */
  files: IHubFile[];
}

export interface IHubListedFile {
  path: string;
  sizeBytes: number;
}

export interface IHubListing {
  /** The repository as the Hub spells it, whatever case it was asked for in. */
  repository: string;

  revision: string;

  /** Sorted by path. */
  files: IHubListedFile[];

  truncated: boolean;
}

interface IHubCommit {
  repository: string;
  commit: string;
  gated: boolean;
}

interface IHubAnswer {
  errorCode: string | null;
}

interface IHubCredentials {
  hubUrl: string;
  accessToken: string | undefined;
  fetch: HubFetch;
}

/** Reads with `HUGGINGFACE_TOKEN` where one is set, and public repositories alone where not. */
@Injectable()
export class HubReaderService {
  private readonly logger = new Logger(HubReaderService.name);

  constructor(private readonly configService: ConfigService) {}

  fileUrl(repository: string, revision: string, path: string): string {
    const endpoint = this.configService.huggingfaceEndpoint.replace(/\/+$/, '');
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');

    return `${endpoint}/${repository}/resolve/${revision}/${encodedPath}`;
  }

  async read(repository: string, revision: string, paths: string[]): Promise<IHubSnapshot> {
    const pinned = await this.pin(repository, revision);
    const found = await this.ask(repository, revision, hubFetch =>
      pathsInfo({ ...this.credentials(hubFetch), repo: pinned.repository, paths, revision: pinned.commit })
    );
    const byPath = new Map(found.map(entry => [entry.path, entry]));
    const missing = paths.filter(path => byPath.get(path)?.type !== 'file');

    if (missing.length > 0) {
      throw new BadRequestException(`${pinned.repository} holds no file ${missing.join(', ')} at ${pinned.commit}`);
    }

    return {
      repository: pinned.repository,
      revision: pinned.commit,
      files: paths.map(path => this.toFile(byPath.get(path), path)),
    };
  }

  /** Download from the returned `revision`, so what downloads is what was listed. */
  async list(repository: string, revision: string): Promise<IHubListing> {
    const pinned = await this.pin(repository, revision);
    const files: IHubListedFile[] = [];
    let truncated = false;

    await this.ask(repository, revision, async hubFetch => {
      const entries = listFiles({
        ...this.credentials(hubFetch),
        repo: pinned.repository,
        recursive: true,
        revision: pinned.commit,
      });

      for await (const entry of entries) {
        if (entry.type !== 'file') {
          continue;
        }

        if (files.length === MAX_LISTED_FILES) {
          truncated = true;
          break;
        }

        files.push({ path: entry.path, sizeBytes: entry.size });
      }
    });

    if (pinned.gated && files.length > 0) {
      await this.checkGranted(pinned, files[0].path, revision);
    }

    files.sort((left, right) => left.path.localeCompare(right.path));

    return { repository: pinned.repository, revision: pinned.commit, files, truncated };
  }

  /**
   * The Hub shows a gated repository's metadata and tree to anyone, but reads its files only for an account granted it.
   * Without a token a gated repository is refused here; with one, a file read answers for whether it was granted.
   */
  private async pin(repository: string, revision: string): Promise<IHubCommit> {
    if (!DOWNLOAD_REPOSITORY_PATTERN.test(repository)) {
      throw new BadRequestException('A repository is named as owner/name');
    }

    const info = await this.ask(repository, revision, hubFetch =>
      modelInfo({ ...this.credentials(hubFetch), name: repository, revision, additionalFields: ['sha'] })
    );

    if (info.gated !== false && this.configService.huggingfaceToken === null) {
      throw new BadRequestException(`${info.name} is gated, and cannot be downloaded without a token`);
    }

    if (typeof info.sha !== 'string' || !DOWNLOAD_REVISION_PATTERN.test(info.sha)) {
      this.logger.error({ repository, revision, sha: info.sha }, 'pin(): The Hub named no commit for a revision');

      throw new InternalServerErrorException();
    }

    return { repository: info.name, commit: info.sha, gated: info.gated !== false };
  }

  /** The Hub lists a gated repository's tree to anyone; only a file read says whether the token was granted it. */
  private async checkGranted(pinned: IHubCommit, path: string, revision: string): Promise<void> {
    await this.ask(pinned.repository, revision, hubFetch =>
      pathsInfo({ ...this.credentials(hubFetch), repo: pinned.repository, paths: [path], revision: pinned.commit })
    );
  }

  private toFile(entry: PathInfo | undefined, path: string): IHubFile {
    if (entry?.lfs !== undefined) {
      return { path, sizeBytes: entry.size, digestAlgorithm: DownloadDigestAlgorithm.SHA256, digest: entry.lfs.oid };
    }

    if (entry?.oid !== undefined) {
      return { path, sizeBytes: entry.size, digestAlgorithm: DownloadDigestAlgorithm.GIT_SHA1, digest: entry.oid };
    }

    this.logger.error({ path }, 'toFile(): The Hub listed a file with no id to check it against');

    throw new InternalServerErrorException();
  }

  /**
   * Hands `request` the fetch to read with, which notes the Hub's error code, since `HubApiError` drops it. A Hub that
   * cannot be read at all is refused on the repository field, as a 400, the only status whose message the console shows.
   */
  private async ask<T>(repository: string, revision: string, request: (hubFetch: HubFetch) => Promise<T>): Promise<T> {
    const answer: IHubAnswer = { errorCode: null };

    try {
      return await request(async (input, init) => {
        const response = await fetch(input, { ...init, signal: AbortSignal.timeout(HUB_TIMEOUT_MS) });

        answer.errorCode = response.headers.get('x-error-code');

        return response;
      });
    } catch (error: unknown) {
      const refusal =
        error instanceof HubApiError ? this.refusalOf(error.statusCode, answer, repository, revision) : null;

      if (refusal !== null) {
        throw refusal;
      }

      this.logger.error({ error, repository, revision }, 'ask(): Reading a repository from the Hub failed');

      throw fieldRefusal([
        {
          path: 'repository',
          name: 'Repository',
          message: `${this.configService.huggingfaceEndpoint} could not be read`,
        },
      ]);
    }
  }

  /**
   * Without a token the Hub answers 401 alike for a private repository and for one that does not exist, so the two
   * share one message. With one it answers 404 for a repository the token cannot see, named apart from a missing
   * revision by its error code.
   */
  private refusalOf(
    statusCode: number,
    answer: IHubAnswer,
    repository: string,
    revision: string
  ): BadRequestException | null {
    const hasToken = this.configService.huggingfaceToken !== null;

    if (answer.errorCode === HubErrorCode.GATED_REPO && hasToken) {
      return new BadRequestException(
        `${repository} is gated, and the account HUGGINGFACE_TOKEN belongs to has not been granted access`
      );
    }

    if (answer.errorCode === HubErrorCode.REPO_NOT_FOUND || statusCode === 401 || statusCode === 403) {
      return new BadRequestException(
        hasToken
          ? `${repository} does not exist, or HUGGINGFACE_TOKEN cannot reach it`
          : `${repository} does not exist, or is private and cannot be reached without a token`
      );
    }

    if (statusCode === 404) {
      return new BadRequestException(`${repository} has no revision ${revision}`);
    }

    return null;
  }

  private credentials(hubFetch: HubFetch): IHubCredentials {
    return {
      hubUrl: this.configService.huggingfaceEndpoint,
      accessToken: this.configService.huggingfaceToken ?? undefined,
      fetch: hubFetch,
    };
  }
}
