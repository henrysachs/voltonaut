import { TestElement, type TestNodeView } from "./node.js";

export { TestElement, type TestNodeView } from "./node.js";

export function createTestDocument() {
  const body = new TestElement();
  const nodes = new Map<string, TestElement>();
  const created: TestElement[] = [];

  const createElement = (): TestElement => {
    const element = new TestElement();

    created.push(element);

    return element;
  };

  return {
    body,
    created,
    createElement,
    getElementById: (id: string) => nodes.get(id) ?? null,
    querySelector: (selector: string) => nodes.get(selector.slice(1)) ?? null,
    add(id: string) {
      const element = createElement();
      element.id = id;
      nodes.set(id, element);

      return element;
    },
    find(text: string): TestElement {
      const found = created.find((node: TestNodeView) => node.textContent === text);

      if (found === undefined) {
        throw new Error(`Missing ${text}`);
      }

      return found;
    },
  };
}
