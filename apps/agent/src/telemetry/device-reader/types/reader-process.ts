export interface IReaderProcess {
  onStdout(handler: (chunk: string) => void): void;
  onStderr(handler: (chunk: string) => void): void;
  onExit(handler: (code: number | null, signal: string | null) => void): void;
  onError(handler: (error: Error) => void): void;

  /** The snapshot it asks for arrives on stdout. */
  request(): void;

  kill(): void;
}

export interface IReaderCommand {
  command: string;
  intervalSeconds: number;
}
