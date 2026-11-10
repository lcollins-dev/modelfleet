export class Toast {
  timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public id: number,
    public title: string,
    public content: string
  ) {}
}
