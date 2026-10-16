import { WebSocket } from 'ws';

export interface ISocketPort {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export function toSocketPort(socket: WebSocket): ISocketPort {
  return {
    send: frame => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
      }
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
  };
}
