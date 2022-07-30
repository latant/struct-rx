import Im from "immutable";
import React, { ReactElement, useEffect, useRef, useState } from "react";

type Getters<T> = Readonly<
  Omit<{ [K in SafeKey<T>]: State<SafeVal<T, K>> }, keyof IState<any>>
>;

type IState<T> = {
  get<K extends SafeKey<T>>(key: K): State<SafeVal<T, K>>;
  read(): T;
  use(): T;
  readKeys(): UnsafeKey<T>[];
  useKeys(): UnsafeKey<T>[];
  readSize(): number;
  useSize(): number;
  readKind(): StateKind;
  useKind(): StateKind;
  update(value: T): void;
  removeKey<K extends RemovableKey<T, SafeKey<T>>>(key: K): void;
};

export type State<T> = IState<T> & Getters<T>;

type Key = keyof any;
type Keys = Key[];
type StateKind = "atomic" | "object" | "array" | "undefined";
type Atomic = boolean | string | number | (() => any);
type UnsafeKey<T> = T extends any[] ? number : string;
type SafeKey<T> = undefined extends T
  ? never
  : null extends T
  ? never
  : T extends Atomic
  ? never
  : T extends any[]
  ? number
  : keyof T;
type UnsafeVal<T, K> = K extends keyof T ? T[K] : never;
type SafeVal<T, K> = K extends keyof T
  ? string extends K
    ? T[K] | undefined
    : number extends K
    ? T[K] | undefined
    : T[K]
  : never;
type RemovableKey<T, K> = undefined extends SafeVal<T, K> ? K : never;

export function createState<T>(value: T): State<T> {
  const state = createStateImpl(new StateRef(new Node(undefined), []));
  state.update(value);
  return state as any;
}

export function useLocalState<T>(value: T): State<T> {
  return useState(() => createState(value))[0];
}

export function ForEach<T extends object, I extends boolean>(props: {
  indexed?: I;
  in: State<T>;
  children: (
    state: State<UnsafeVal<T, UnsafeKey<T>>>,
    key: UnsafeKey<T>,
    ...i: true extends I ? [number] : []
  ) => ReactElement;
}) {
  const states = useRef<{ [key: string]: State<any> }>({});
  const keys = props.in.useKeys();
  states.current = Object.fromEntries(
    keys.map((k) => [k, states.current[k] ?? props.in.get(k as any)])
  );
  return (
    <>
      {Object.entries(states.current).map(([k, v], i) => (
        <Item
          key={k}
          stateKey={k}
          state={v}
          index={props.indexed ? i : undefined}
          func={props.children}
        />
      ))}
    </>
  );
}

function Item(props: {
  stateKey: string;
  state: State<any>;
  index?: number;
  func: (...args: any) => any;
}) {
  return props.index === undefined
    ? props.func(props.state, props.stateKey)
    : props.func(props.state, props.stateKey, props.index);
}

export function When<T>(props: {
  exists: boolean;
  state: State<T>;
  children: (state: State<NonNullable<T>>) => any;
}) {
  const kind = props.state.useKind();
  const exists = kind !== "undefined";
  const component = functionWithName("Exists", () => (
    <>{props.children(props.state as any)}</>
  ));
  return exists === props.exists ? React.createElement(component) : null;
}

export function Switch<T extends object, P extends keyof T>(props: {
  state: State<T>;
  property: P;
  children: T[P] extends string
    ? { [key in T[P]]: (state: State<T & { [k in P]: key }>) => ReactElement }
    : never;
}) {
  const [components] = useState(() => {
    const result: { [key: string]: (props: { state: any }) => ReactElement } =
      {};
    for (const k in props.children) {
      result[k] = functionWithName(k, ({ state }) => props.children[k](state));
    }
    return result;
  });
  const propState = props.state.get(props.property as any) as State<T[P]>;
  const propValue = propState.use();
  return React.createElement(components[propValue as any], {
    state: props.state,
  });
}

class Subscriber {
  readonly reaction: () => any;
  subscribed = false;
  topics: Topic<any>[] = [];
  constructor(reaction: () => any) {
    this.reaction = reaction;
  }
  notify() {
    Subscriber.notified.add(this);
  }
  subscribe() {
    this.subscribed = true;
    for (const a of this.topics) {
      a.subscribe(this);
    }
  }
  unsubscribe() {
    this.subscribed = false;
    for (const a of this.topics) {
      a.unsubscribe(this);
    }
  }
  private static notified = new Set<Subscriber>();
  static flush() {
    const called = this.notified;
    this.notified = new Set();
    called.forEach((s) => s.subscribed && s.reaction());
  }
}

class Topic<T> {
  private value: T;
  private readonly subscribers = new Set<Subscriber>();
  detach?: () => any;
  constructor(value: T, detach?: () => any) {
    this.value = value;
    this.detach = detach;
  }
  get() {
    return this.value;
  }
  set(value: T) {
    const prevValue = this.value;
    this.value = value;
    if (prevValue !== this.value) {
      this.subscribers.forEach((s) => s.notify());
    }
    this.tryDetach();
  }
  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
  }
  unsubscribe(subscriber: Subscriber) {
    this.subscribers.delete(subscriber);
    this.tryDetach();
  }
  private tryDetach() {
    if (
      this.detach &&
      this.subscribers.size === 0 &&
      this.value === undefined
    ) {
      this.detach();
    }
  }
}

class Branch {
  isArray = false;
  keys = new Topic(Im.OrderedSet<string>());
  nodes = new Map<string, Node>();
  getOrCreateNode(key: string) {
    if (!this.nodes.has(key)) {
      this.nodes.set(key, this.createChild(key));
    }
    if (!this.keys.get().has(key)) {
      this.keys.set(this.keys.get().add(key));
    }
    return this.nodes.get(key) as Node;
  }
  createVolatileNode(key: string) {
    const node = this.createChild(key);
    this.nodes.set(key, node);
    return node;
  }
  removeKey(key: string) {
    this.keys.set(this.keys.get().delete(key));
    this.nodes.get(key)?.set(undefined);
  }
  private createChild(key: string) {
    const child = new Node(undefined, () => {
      this.nodes.delete(key);
    });
    child.parent = { key, branch: this };
    return child;
  }
}

class Node extends Topic<Topic<any> | Branch | undefined> {
  parent?: { key: string; branch: Branch };

  extractValue(): any {
    const x = this.get();
    if (x === undefined) return;
    if (x instanceof Topic) return x.get();
    if (x.isArray) {
      const result: any[] = [];
      x.keys.get().forEach((k) => {
        result.push(x.nodes.get(k)!.extractValue());
      });
      return result;
    } else {
      const result: { [key: Key]: any } = {};
      x.keys.get().forEach((k) => {
        result[k] = x.nodes.get(k)!.extractValue();
      });
      return result;
    }
  }

  getNode(keys: Keys): Node | undefined {
    let actual: Node = this;
    for (const k of keys) {
      const x = actual.get();
      if (!(x instanceof Branch)) return;
      const next = x.nodes.get(k.toString());
      if (next === undefined) return;
      actual = next;
    }
    return actual;
  }

  getNodeAndTopics(keys: Keys): [Node | undefined, Topic<any>[]] {
    let actual: Node = this;
    const topics: Topic<any>[] = [actual];
    for (const k of keys) {
      const x = actual.get();
      if (!(x instanceof Branch)) return [undefined, topics];
      actual = x.nodes.get(k.toString()) || x.createVolatileNode(k.toString());
      topics.push(actual);
    }
    return [actual, topics];
  }

  collectTopicsInto(topics: Topic<any>[]) {
    const x = this.get();
    if (x instanceof Topic) {
      topics.push(x);
    }
    if (x instanceof Branch) {
      topics.push(x.keys);
      x.nodes.forEach((n) => {
        topics.push(n);
        n.collectTopicsInto(topics);
      });
    }
  }

  getOrCreateNode(keys: Keys): Node {
    let actual: Node = this;
    for (const k of keys) {
      actual = actual.getOrCreateBranch().getOrCreateNode(k.toString());
    }
    return actual;
  }

  getOrCreateBranch(): Branch {
    if (!(this.get() instanceof Branch)) {
      this.set(new Branch());
    }
    return this.get() as Branch;
  }

  getOrCreateTopic(): Topic<any> {
    if (!(this.get() instanceof Topic)) {
      this.set(new Topic(undefined));
    }
    return this.get() as Topic<any>;
  }

  update(value: any) {
    if (value === undefined || value === null) {
      if (this.parent) {
        this.parent.branch.removeKey(this.parent.key);
      } else {
        this.set(undefined);
      }
    } else if (typeof value === "object") {
      const n = this.getOrCreateBranch();
      n.isArray = Array.isArray(value);
      const keys = Im.OrderedSet(Object.keys(value));
      n.keys.get().forEach((k) => {
        if (!keys.has(k)) {
          n.nodes.get(k)?.set(undefined);
        }
      });
      n.keys.set(n.keys.get().intersect(keys));
      keys.forEach((k) => {
        n.getOrCreateNode(k.toString()).update(value[k]);
      });
    } else {
      this.getOrCreateTopic().set(value);
    }
  }
}

class StateRef {
  readonly root: Node;
  readonly keys: Keys;
  constructor(root: Node, keys: Keys) {
    this.root = root;
    this.keys = keys;
  }
}

const createStateImpl: (state: StateRef) => IState<any> = implementProxy<
  StateRef,
  IState<any>
>(
  ({ root, keys }, key) => createStateImpl(new StateRef(root, [...keys, key])),
  {
    get(key: Key): any {
      return createStateImpl(new StateRef(this.root, [...this.keys, key]));
    },

    read(): any {
      return this.root.getNode(this.keys)?.extractValue();
    },

    use(): any {
      return useTopics(() => {
        const [node, topics] = this.root.getNodeAndTopics(this.keys);
        if (node !== undefined) {
          node.collectTopicsInto(topics);
          return [node.extractValue(), topics];
        }
        return [undefined, topics];
      });
    },

    readKind(): StateKind {
      const x = this.root.getNode(this.keys)?.get();
      return getStateKind(x);
    },

    useKind(): StateKind {
      return useTopics(() => {
        const [node, topics] = this.root.getNodeAndTopics(this.keys);
        return [getStateKind(node?.get()), topics];
      });
    },

    readKeys(): any {
      const x = this.root.getNode(this.keys)?.get();
      return x instanceof Branch ? x.keys.get().toArray() : [];
    },

    useKeys(): any {
      return useTopics(() => {
        const [node, topics] = this.root.getNodeAndTopics(this.keys);
        const x = node?.get();
        if (x instanceof Branch) {
          topics.push(x.keys);
          return [x.keys.get().toArray(), topics];
        }
        return [[], topics];
      });
    },

    readSize(): number {
      const x = this.root.getNode(this.keys)?.get();
      return x instanceof Branch ? x.keys.get().size : 0;
    },

    useSize(): number {
      return useTopics(() => {
        const [node, topics] = this.root.getNodeAndTopics(this.keys);
        const x = node?.get();
        if (x instanceof Branch) {
          topics.push(x.keys);
          return [x.keys.get().size, topics];
        }
        return [0, topics];
      });
    },

    update(value: any) {
      validateStateInput(value);
      this.root.getOrCreateNode(this.keys).update(value);
      Subscriber.flush();
    },

    removeKey(key: Key) {
      const x = this.root.getNode(this.keys)?.get();
      if (x instanceof Branch) {
        x.removeKey(key.toString());
      }
      Subscriber.flush();
    },
  }
);

function implementProxy<
  T extends object,
  I extends { [prop: string]: (...args: any) => any }
>(
  getter: (target: T, key: keyof any) => any,
  implementation: {
    [K in keyof I]: (this: T, ...args: Parameters<I[K]>) => ReturnType<I[K]>;
  }
): (proxied: T) => I {
  const proxyHandler: ProxyHandler<T> = {
    get(target, p, receiver) {
      const f = implementation[p as any];
      return f ? f.bind(target) : getter(target, p);
    },
  };
  return (proxied) => new Proxy(proxied, proxyHandler) as any;
}

function isAtomicValue(value: any) {
  const t = typeof value;
  return (
    t === "boolean" || t === "string" || t === "number" || t === "function"
  );
}

function validateStateInput(value: any) {
  if (value === undefined || value === null) {
    return;
  }
  if (isAtomicValue(value)) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(validateStateInput);
    return;
  }
  if (Object.getPrototypeOf(value).constructor === Object) {
    Object.values(value).forEach(validateStateInput);
    return;
  }
  throw new Error(`Invalid state input: ${value}`);
}

function useSubscriber(reaction: () => any) {
  return useRef(new Subscriber(reaction)).current;
}

function useTopics<T>(produce: () => [T, Topic<any>[]]) {
  const subscriber = useSubscriber(() => {
    subscriber.unsubscribe();
    const [nextValue, nextTopics] = produce();
    subscriber.topics = nextTopics;
    subscriber.subscribe();
    setValue(() => nextValue);
  });
  const [value, setValue] = useState(() => {
    const [firstValue, nextTopics] = produce();
    subscriber.topics = nextTopics;
    subscriber.subscribe();
    return firstValue;
  });
  useEffect(() => {
    subscriber.subscribe();
    return () => {
      subscriber.unsubscribe();
    };
  }, []);
  return value;
}

function getStateKind(value: any): StateKind {
  return value instanceof Topic
    ? "atomic"
    : value instanceof Branch
    ? value.isArray
      ? "array"
      : "object"
    : "undefined";
}

function functionWithName<F extends (...args: any[]) => any>(
  name: string,
  func: F
): F {
  const obj = { [name]: (...args: any[]) => func(...args) };
  return obj[name] as any;
}
