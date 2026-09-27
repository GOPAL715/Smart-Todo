import { Suspense, lazy, type ComponentType } from "react";
import { RouteFallback } from "@/components/RouteFallback";

/**
 * Wraps a page component that is loaded on demand.
 *
 * `React.lazy` starts fetching a route's chunk the first time the route is
 * matched, so the work happens per navigation rather than during startup. The
 * `Suspense` boundary lives here, inside the returned component, rather than
 * around the whole router: a boundary placed outside would blank the sidebar
 * and header while any single page was loading.
 *
 * A failed chunk import — the usual cause being a deploy that replaced chunk
 * files an already-open tab still references — rejects during render, so the
 * existing `ErrorBoundary` above the router catches it and offers a reload. No
 * additional error handling is needed for that case.
 *
 * The loader resolves to the component itself rather than a module namespace,
 * because the pages in this app are named exports. Adapting here means no page
 * module has to be given a default export purely to be split.
 *
 * Kept as a factory rather than a wrapper component so the `lazy()` call
 * happens once at module scope. Declaring it inside a component body would
 * create a brand-new component type on every render, remounting the page and
 * discarding its state each time.
 */
export function lazyRoute<P extends object>(
  load: () => Promise<ComponentType<P>>
): ComponentType<P> {
  const Component = lazy(async () => ({ default: await load() }));

  return function LazyRoute(props: P) {
    // `props` is spread through untyped because React cannot express "a
    // component's own props" generically; the constraint is enforced at the call
    // site, where the loader's component type fixes P.
    const Typed = Component as unknown as ComponentType<Record<string, unknown>>;
    return (
      <Suspense fallback={<RouteFallback />}>
        <Typed {...(props as Record<string, unknown>)} />
      </Suspense>
    );
  };
}

