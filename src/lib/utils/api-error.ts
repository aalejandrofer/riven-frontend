/**
 * Readable text for an error body returned by the generated Riven client.
 *
 * openapi-fetch types `error` as the operation's error response — for Riven that is
 * `HTTPValidationError`, i.e. `{ detail: ValidationError[] }`. It has no `message`, and
 * `detail` is usually an array, so the two patterns this replaces both produced junk:
 * `err.message || err.detail` needed a `@ts-ignore` and then rendered "[object Object]",
 * and `String(err)` / `err as string` rendered "[object Object]" without even a warning.
 */
export function describeApiError(err: unknown, fallback: string): string {
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
        const record = err as Record<string, unknown>;
        if (typeof record.message === "string" && record.message) return record.message;
        const detail = record.detail;
        if (typeof detail === "string" && detail) return detail;
        if (Array.isArray(detail)) {
            const parts = detail
                .map((entry) => {
                    if (entry && typeof entry === "object") {
                        const msg = (entry as Record<string, unknown>).msg;
                        if (typeof msg === "string") return msg;
                    }
                    return null;
                })
                .filter((part): part is string => part !== null);
            if (parts.length > 0) return parts.join("; ");
        }
    }
    return fallback;
}
