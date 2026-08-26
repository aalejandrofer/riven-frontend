import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals, fetch, url }) => {
    const { itemId, file } = params;

    if (!itemId || !file) {
        error(400, "Invalid parameters");
    }

    // Map SvelteKit path to Backend path
    // Incoming: /api/stream/123/hls/index.m3u8
    // Target:   {backend}/stream/hls/123/index.m3u8
    // Incoming: /api/stream/123/hls/segment/0.ts
    // Target:   {backend}/stream/hls/123/segment/0.ts
    const backendUrl = `${locals.backendUrl}/api/v1/stream/hls/${itemId}/${file}${url.search}`;

    const headers: HeadersInit = {
        "x-api-key": locals.apiKey
    };

    // `duplex` is part of the fetch standard's RequestInit but is still missing from
    // TypeScript's DOM lib (microsoft/TypeScript#53157), so it needs a widened init object.
    // It was previously silenced with a bare `@ts-ignore`, which also hid every other typo
    // in this object. Behaviour is unchanged: kept because undici requires `duplex` on any
    // request it may stream, and dropping it is not worth risking on the playback path.
    const init: RequestInit & { duplex?: "half" } = {
        headers,
        duplex: "half"
    };

    try {
        const response = await fetch(backendUrl, init);

        if (!response.ok) {
            console.error(`Backend HLS error: ${response.status} for ${file}`);
            error(response.status, "Failed to fetch HLS stream");
        }

        const responseHeaders = new Headers();
        // Forward key headers
        const type = response.headers.get("content-type");
        if (type) responseHeaders.set("content-type", type);

        // Caching is important for segments, but BAD for the playlist (if live)
        // Since this is VOD, we can cache segments aggressively
        if (file.endsWith(".ts")) {
            responseHeaders.set("cache-control", "public, max-age=3600");
        }

        return new Response(response.body, {
            status: 200,
            headers: responseHeaders
        });
    } catch (e) {
        console.error("HLS proxy error:", e);
        error(502, "Failed to proxy HLS");
    }
};
