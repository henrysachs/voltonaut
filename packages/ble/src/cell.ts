export interface Cell<T> {
  readonly get: () => T;
  readonly set: (value: T) => void;
}

export function createCell<T>(): Cell<T | undefined>;
export function createCell<T>(initial: T): Cell<T>;
export function createCell<T>(initial?: T): Cell<T | undefined> {
  let value = initial;

  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}
