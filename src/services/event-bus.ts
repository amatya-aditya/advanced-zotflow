type Listener<T extends unknown[]> = (...args: T) => void;

/**
 * Lightweight typed pub/sub channel.
 *
 * Each `EventBus` instance represents a single event type.
 * Subscribers receive the exact tuple of arguments passed to `emit()`.
 *
 * @example
 * ```ts
 * const bus = new EventBus<[number, string]>();
 * const unsub = bus.subscribe((id, name) => console.log(id, name));
 * bus.emit(42, "hello");
 * unsub(); // stop listening
 * ```
 */
export class EventBus<T extends unknown[]> {
    private listeners = new Set<Listener<T>>();

    /** Notify all current subscribers with the given arguments. */
    emit(...args: T): void {
        this.listeners.forEach((cb) => cb(...args));
    }

    /**
     * Register a listener. Returns an unsubscribe function.
     */
    subscribe(callback: Listener<T>): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }
}
