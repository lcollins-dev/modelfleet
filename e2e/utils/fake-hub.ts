import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';

export const FAKE_HUB_PUBLIC = 'e2e/tiny-gguf';
export const FAKE_HUB_FILE = 'tiny.gguf';

export const FAKE_HUB_OTHER_FILE = 'tiny-Q8_0.gguf';

const COMMIT = '50968a4468ef4233ed78cd7c3de230dd1d61a56b';

const FILES = [
  {
    path: FAKE_HUB_FILE,
    type: 'file',
    oid: 'f8f078643b71179df66f671b3f576db3925db1ea',
    size: 1_048_576,
    lfs: { oid: 'e150ed544dfe6016930c026a93913a5e3184181ebfe6ab2223ae01dd0491784c', size: 1_048_576, pointerSize: 134 },
  },
  {
    path: FAKE_HUB_OTHER_FILE,
    type: 'file',
    oid: '0b3a1f2e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a',
    size: 2_097_152,
    lfs: { oid: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', size: 2_097_152, pointerSize: 134 },
  },
];

const MODEL_INFO = /^\/api\/models\/([^/]+\/[^/]+)\/revision\//;
const PATHS_INFO = /^\/api\/models\/[^/]+\/[^/]+\/paths-info\//;
const TREE = /^\/api\/models\/[^/]+\/[^/]+\/tree\/([^/?]+)/;

/** Answers the calls the server makes to read one public repository. The tree answers at the commit alone. */
export class FakeHub {
  private readonly server: Server;

  constructor() {
    this.server = createServer((request, response) => {
      this.answer(request, response).catch(() => {
        response.writeHead(500).end();
      });
    });
  }

  async start(port: number): Promise<void> {
    await new Promise<void>(resolve => this.server.listen(port, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '';
    const modelInfo = MODEL_INFO.exec(url);
    const tree = TREE.exec(url);

    if (modelInfo !== null && decodeURIComponent(modelInfo[1]) === FAKE_HUB_PUBLIC) {
      this.json(response, 200, { id: FAKE_HUB_PUBLIC, sha: COMMIT, gated: false });

      return;
    }

    if (PATHS_INFO.test(url) && request.method === 'POST') {
      const body = JSON.parse(await this.readBody(request)) as { paths: string[] };

      this.json(
        response,
        200,
        FILES.filter(file => body.paths.includes(file.path))
      );

      return;
    }

    if (tree !== null && decodeURIComponent(tree[1]) === COMMIT) {
      this.json(response, 200, FILES);

      return;
    }

    this.json(response, 401, { error: 'Invalid username or password.' });
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.setHeader('content-type', 'application/json');
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
