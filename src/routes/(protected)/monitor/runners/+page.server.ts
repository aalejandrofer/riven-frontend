import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ fetch, locals }) => {
    const resp = await fetch(`${locals.backendUrl}/api/v1/runners?limit=25`, {
        headers: { "x-api-key": locals.apiKey }
    });
    if (!resp.ok) {
        error(500, `Failed to read runners (HTTP ${resp.status})`);
    }
    return await resp.json();
};
