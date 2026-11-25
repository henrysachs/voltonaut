export interface TestNodeView {
  readonly textContent: string;
  readonly open: boolean;
  readonly download: string;
}

export class TestElement {
  textContent = "";
  value = "";
  checked = false;
  type = "";
  required = false;
  autocomplete = "";
  id = "";
  hidden = false;
  disabled = false;
  href = "";
  download = "";
  open = false;
  readonly children: TestElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (() => void)[]>();
  readonly dataset: Record<string, string> = {};

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- A DOM fake retains mutable node references so tests can observe later renders.
  append(...children: readonly TestElement[]): void {
    this.children.push(...children);
  }
  replaceChildren(): void {
    this.children.length = 0;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }
  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  fire(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener();
    }
  }
  click(): void {
    this.fire("click");
  }
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
  }
}
