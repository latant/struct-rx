# Struct RX
[![npm version](https://badge.fury.io/js/struct-rx.svg)](https://badge.fury.io/js/struct-rx)
A solution for working with structured global state in React applications.

## Rationale
React users are often puzzled by problems which are easier to solve with a component-independent state construct which also respects the internal structure of the state. This library provides a dynamic, recursive data structure, with an easy-to-use, type-safe interface, which makes working with hierarchic application state a breeze.
Use this data-structure if you want to have:
- States that are independent from the components using them
- Persistent global state between changes during development

You can read the train of thought leading to this solution [here](docs/implementation-details.md).

## How to use it
Define your application's global state in a separate file, e.g. GlobalState.ts
```
import { createState } from "struct-rx";

type TodosGlobalState = {
  todos: Todo[];
  newTodo: { title: string };
};

export type Todo = {
  title: string;
  done: boolean;
};

export const globalState = createState<TodosGlobalState>({
  todos: [
    {
      title: "Take out trash",
      done: false,
    },
  ],
  newTodo: { title: "" },
});
```
Use it anywhere:
```
import { globalState, Todo } from "./GlobalState";
import { ForEach, State } from "struct-rx";

function App() {
  return (
    <div>
      <ForEach in={globalState.todos}>{(t) => <TodoEntry state={t} />}</ForEach>
      <CreateTodo />
    </div>
  );
}

function CreateTodo() {
  const title = globalState.newTodo.title;
  const create = () => {
    const newTodo = {
      title: title.read(),
      done: false,
    };
    globalState.todos.update([...globalState.todos.read(), newTodo]);
  };
  return (
    <div style={{ margin: "12px" }}>
      <Input state={title} />
      <button onClick={create}>Create</button>
    </div>
  );
}

function Input(props: { state: State<string> }) {
  return (
    <input
      value={props.state.use()}
      onChange={(e) => props.state.update(e.target.value)}
    />
  );
}

function TodoEntry(props: { state: State<Todo> }) {
  const title = props.state.title.use();
  const done = props.state.done.use();
  const toggle = () => {
    props.state.done.update(!props.state.done.read());
  };
  return (
    <div style={{ display: "flex", margin: "10px" }}>
      <div>{title}</div>
      <input
        type="checkbox"
        checked={done}
        style={{ margin: "10px" }}
        onChange={toggle}
      />
    </div>
  );
}
```
## Building-blocks
The solution treats the state as a tree of nodes and exposes the single ``State<T>`` interface.
```
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
```
Values of this type can only be instantiated by the ``createState`` function.
It consist of the possible operations and shorthand properties to avoid flooding your code with ``state.get("property")`` calls and be able to write ``state.property`` instead.

``get`` is for navigating on the tree, like getting a value for a key in a hashmap or getting an element at a specified index in a list. The result is also a ``State`` with the type of the child.
``read`` is for simply extracting the data held in the tree.
``use`` is for using the state in render function, by depending on it. Any change under the tree of this state triggers a rerender.
``update`` is for mutating the state by overwriting it with the given new value. If parts of the new value match the old one, no rerenders are triggered on the components depending on those parts.

``useKeys``, ``readKeys`` are for getting the keys of the state inside or outside the render function. It is only practical for states with type of an *array* or *object*
``useSize``, ``readSize`` are for getting the size of an array/object state. The return the size of the keys return by the previously introduced function, with the extra that ``useSize`` doesn't trigger rerender when the content of the keys changes but the size of the keys doesn't.
``useKind``, ``readKind`` are for dynamically checking if the state is a structural or an atomic data. It's result can be one of the following: ``"atomic" | "array" | "object" | "undefined``
``removeKey`` is for removing an element from an array/object state.
## What types of data can it hold?
Shortly: any of them, with a tiny limitation.
The structural types can be ``object`` or ``array`` types.
The atomic ones are ``boolean``, ``number``, ``string`` and ``function``.
Functions must be used for wrapping any non-primitive atomic types. (e.g. ``Date``) The reason for this is that they are structural types in TypeScript's type-system, so they would need to be whitelisted in this library's type definition. We simply can't know every one of these types and need to make the definition consistent.
