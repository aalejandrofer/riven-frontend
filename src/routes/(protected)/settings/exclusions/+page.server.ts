import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// Exclusions page moved to the top-level /blocklist route (Seerr-style wording).
export const load: PageServerLoad = async () => {
    redirect(308, "/blocklist");
};
