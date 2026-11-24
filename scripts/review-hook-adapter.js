/* Offline design-review adapter only. The Next.js apps use normal React 19.
   React 16.0 bundled in this environment has no hooks. Adapt the limited hooks
   used by the demo components, without touching the app source. */
(function (R) {
  if (R.useState) return;
  const create = R.createElement.bind(R),
    wrappers = new WeakMap(),
    refs = new WeakMap();
  let owner = null;
  function same(a, b) {
    return !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  }
  function wrap(fn) {
    if (wrappers.has(fn)) return wrappers.get(fn);
    class PreviewComponent extends R.Component {
      constructor(props) {
        super(props);
        this.slots = [];
        this.pending = [];
        this.cursor = 0;
        this.alive = true;
        this.scheduled = false;
        this.state = { revision: 0 };
      }
      refresh() {
        if (!this.alive || this.scheduled) return;
        this.scheduled = true;
        Promise.resolve().then(() => {
          this.scheduled = false;
          if (this.alive) this.setState((s) => ({ revision: s.revision + 1 }));
        });
      }
      flush() {
        const pending = this.pending;
        this.pending = [];
        for (const i of pending) {
          const s = this.slots[i];
          if (s.cleanup) s.cleanup();
          const result = s.effect();
          s.cleanup = typeof result === 'function' ? result : null;
        }
      }
      componentDidMount() {
        this.flush();
      }
      componentDidUpdate() {
        this.flush();
      }
      componentWillUnmount() {
        this.alive = false;
        for (const s of this.slots) if (s && typeof s.cleanup === 'function') s.cleanup();
      }
      render() {
        this.cursor = 0;
        this.pending = [];
        const prev = owner;
        owner = this;
        try {
          return fn(this.props);
        } finally {
          owner = prev;
        }
      }
    }
    wrappers.set(fn, PreviewComponent);
    return PreviewComponent;
  }
  R.createElement = function (type, props, ...children) {
    if (typeof type === 'function' && !(type.prototype && type.prototype.isReactComponent)) type = wrap(type);
    if (props && props.ref && typeof props.ref === 'object') {
      const ref = props.ref;
      if (!refs.has(ref))
        refs.set(ref, (node) => {
          ref.current = node;
        });
      props = { ...props, ref: refs.get(ref) };
    }
    return create(type, props, ...children);
  };
  R.useState = function (init) {
    const o = owner,
      i = o.cursor++;
    if (!o.slots[i]) {
      const s = { value: typeof init === 'function' ? init() : init };
      s.set = (v) => {
        const next = typeof v === 'function' ? v(s.value) : v;
        if (!Object.is(s.value, next)) {
          s.value = next;
          o.refresh();
        }
      };
      o.slots[i] = s;
    }
    const s = o.slots[i];
    return [s.value, s.set];
  };
  R.useRef = function (value) {
    const o = owner,
      i = o.cursor++;
    if (!o.slots[i]) o.slots[i] = { ref: { current: value } };
    return o.slots[i].ref;
  };
  R.useEffect = function (effect, deps) {
    const o = owner,
      i = o.cursor++;
    const s = o.slots[i] || (o.slots[i] = {});
    if (!same(s.deps, deps)) {
      s.deps = deps;
      s.effect = effect;
      o.pending.push(i);
    }
  };
  R.useMemo = function (fn, deps) {
    const o = owner,
      i = o.cursor++;
    const s = o.slots[i] || (o.slots[i] = {});
    if (!same(s.deps, deps)) {
      s.deps = deps;
      s.value = fn();
    }
    return s.value;
  };
  R.useCallback = (fn, deps) => R.useMemo(() => fn, deps);
})(window.React);
