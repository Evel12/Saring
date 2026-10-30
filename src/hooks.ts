import { useEffect, useRef, useState } from "react";
import { request, ApiError } from "./api";
import type { Activity } from "./types";
export function useLoad<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  keys: unknown[],
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const fn = useRef(loader);
  fn.current = loader;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    fn.current(controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [...keys, retry]);
  return { data, error, loading, reload: () => setRetry((n) => n + 1) };
}
export function useEvents(
  filter: { vacancy_id?: string; application_id?: string },
  onChange: () => void,
) {
  const [events, setEvents] = useState<Activity[]>([]);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [updated, setUpdated] = useState<number>();
  const [retry, setRetry] = useState(0);
  const change = useRef(onChange);
  change.current = onChange;
  const key = JSON.stringify(filter);
  const savedCursor = useRef<{ key: string; after?: string }>({ key });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (savedCursor.current.key !== key) {
      savedCursor.current = { key };
      setEvents([]);
      setUpdated(undefined);
    }
    let cursor: string | undefined = savedCursor.current.after;
    let failures = 0;
    setConnection("connecting");
    async function poll() {
      try {
        const query = new URLSearchParams({ ...filter, limit: "50" });
        if (cursor) query.set("after", cursor);
        else query.set("tail", "true");
        const result = await request<{
          items: Activity[];
          next_cursor: string | null;
          has_more: boolean;
        }>("/events/changes?" + query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setEvents((old) => {
          const ids = new Set(old.map((e) => e.id));
          return [...old, ...result.items.filter((e) => !ids.has(e.id))].slice(
            -200,
          );
        });
        cursor = result.next_cursor || cursor;
        savedCursor.current.after = cursor;
        setConnection("connected");
        setUpdated(Date.now());
        failures = 0;
        if (result.items.length) change.current();
        timer = setTimeout(poll, result.has_more ? 0 : 3000);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (cursor && e instanceof ApiError && e.status === 404) {
          // Erasure/reset may remove the cursor. Rebuild only from an authorized tail.
          cursor = undefined;
          savedCursor.current.after = undefined;
          setEvents([]);
          setUpdated(undefined);
          setConnection("connecting");
          change.current();
          timer = setTimeout(poll, 0);
          return;
        }
        setConnection("disconnected");
        failures++;
        timer = setTimeout(poll, Math.min(30000, 1500 * 2 ** failures));
      }
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, retry]);
  return {
    events,
    connection,
    updated,
    reconnect: () => setRetry((n) => n + 1),
  };
}
export function useHash() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/vacancies");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || "/vacancies");
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  return route;
}
export function navigate(path: string) {
  location.hash = path;
}
