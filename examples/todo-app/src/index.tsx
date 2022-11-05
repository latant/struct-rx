import { createState, ForEach, State } from "struct-rx";

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