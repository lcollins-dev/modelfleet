import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';

export const FAKE_HUB_COMMIT = '50968a4468ef4233ed78cd7c3de230dd1d61a56b';

/** Asked for in any case; answers with this spelling, as the Hub does. */
export const FAKE_HUB_PUBLIC = 'Owner/Public-GGUF';
export const FAKE_HUB_GATED = 'owner/gated';
export const FAKE_HUB_GATED_REFUSED = 'owner/gated-refused';

export const FAKE_HUB_PRIVATE = 'owner/private';
export const FAKE_HUB_UNREADABLE = 'owner/unreadable';
export const FAKE_HUB_TOKEN = 'hf_integrationFleetToken';

export const FAKE_HUB_FILES = [
  {
    path: 'model.gguf',
    type: 'file',
    oid: 'f8f078643b71179df66f671b3f576db3925db1ea',
    size: 639_447_744,
    lfs: {
      oid: 'e150ed544dfe6016930c026a93913a5e3184181ebfe6ab2223ae01dd0491784c',
      size: 639_447_744,
      pointerSize: 134,
    },
  },
  { path: 'config.json', type: 'file', oid: 'de077778adaa4aa6e706209cd95a2a0d6049bc59', size: 752 },
  { path: 'Q4_K_M', type: 'directory', oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', size: 0 },
];

interface IFakeRepository {
  id: string;
  gated: false | 'manual';
  private: boolean;
  granted: boolean;
}

const REPOSITORIES: IFakeRepository[] = [
  { id: FAKE_HUB_PUBLIC, gated: false, private: false, granted: true },
  { id: FAKE_HUB_GATED, gated: 'manual', private: false, granted: true },
  { id: FAKE_HUB_GATED_REFUSED, gated: 'manual', private: false, granted: false },
  { id: FAKE_HUB_PRIVATE, gated: false, private: true, granted: true },
];

const MODEL_INFO = /^\/api\/models\/([^/]+\/[^/]+)\/revision\/([^/?]+)/;
const PATHS_INFO = /^\/api\/models\/([^/]+\/[^/]+)\/paths-info\/([^/?]+)/;
const TREE = /^\/api\/models\/([^/]+\/[^/]+)\/tree\/([^/?]+)/;

/**
 * The Hub calls the server makes, over the repositories above. As the Hub does, it hides a private or unknown
 * repository behind 401 without a token and 404 with one, lists a gated one's tree to anyone, and reads its files only
 * for a token whose account was granted it, naming each refusal in `X-Error-Code`. The tree answers at the commit
 * alone, so a listing that did not pin its revision first fails.
 */
export class FakeHub {
  private readonly server: Server;

  constructor() {
    this.server = createServer((request, response) => {
      this.answer(request, response).catch(() => {
        response.writeHead(500).end();
      });
    });
  }

  async start(): Promise<string> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '';
    const authorized = request.headers.authorization === `Bearer ${FAKE_HUB_TOKEN}`;
    const modelInfo = MODEL_INFO.exec(url);
    const pathsInfo = PATHS_INFO.exec(url);
    const tree = TREE.exec(url);

    if (modelInfo !== null) {
      this.answerModelInfo(response, decodeURIComponent(modelInfo[1]), decodeURIComponent(modelInfo[2]), authorized);

      return;
    }

    const named = pathsInfo ?? tree;

    if (
      named !== null &&
      this.visible(response, decodeURIComponent(named[1]), authorized, pathsInfo !== null) === null
    ) {
      return;
    }

    if (pathsInfo !== null && request.method === 'POST') {
      const body = JSON.parse(await this.readBody(request)) as { paths: string[] };

      this.json(
        response,
        200,
        FAKE_HUB_FILES.filter(file => body.paths.includes(file.path))
      );

      return;
    }

    if (tree !== null) {
      if (decodeURIComponent(tree[2]) === FAKE_HUB_COMMIT) {
        this.json(response, 200, FAKE_HUB_FILES);
      } else {
        this.json(response, 404, { error: `Invalid rev id: ${tree[2]}` }, 'RevisionNotFound');
      }

      return;
    }

    this.json(response, 401, { error: 'Invalid username or password.' });
  }

  private answerModelInfo(response: ServerResponse, name: string, revision: string, authorized: boolean): void {
    if (name.toLowerCase() === FAKE_HUB_UNREADABLE) {
      response.writeHead(500).end();

      return;
    }

    const repository = this.visible(response, name, authorized, false);

    if (repository === null) {
      return;
    }

    if (revision !== 'main' && revision !== FAKE_HUB_COMMIT) {
      this.json(response, 404, { error: `Invalid rev id: ${revision}` }, 'RevisionNotFound');
    } else {
      this.json(response, 200, {
        id: repository.id,
        sha: FAKE_HUB_COMMIT,
        gated: repository.gated,
        private: repository.private,
      });
    }
  }

  /** Answers the refusal, and returns null, where `name` is hidden from this caller or its files are gated from it. */
  private visible(
    response: ServerResponse,
    name: string,
    authorized: boolean,
    readsFiles: boolean
  ): IFakeRepository | null {
    const repository = REPOSITORIES.find(candidate => candidate.id.toLowerCase() === name.toLowerCase());

    if (repository === undefined || (repository.private && !authorized)) {
      this.json(response, authorized ? 404 : 401, { error: 'Repository not found' }, 'RepoNotFound');

      return null;
    }

    if (readsFiles && repository.gated !== false && !(authorized && repository.granted)) {
      this.json(response, authorized ? 403 : 401, { error: `Access to ${repository.id} is restricted` }, 'GatedRepo');

      return null;
    }

    return repository;
  }

  private json(response: ServerResponse, status: number, body: unknown, errorCode?: string): void {
    response.setHeader('content-type', 'application/json');

    if (errorCode !== undefined) {
      response.setHeader('x-error-code', errorCode);
    }

    response.writeHead(status).end(JSON.stringify(body));
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }

    return Buffer.concat(chunks).toString('utf8');
  }
}
