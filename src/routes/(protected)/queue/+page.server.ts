import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// Queue moved into the combined Monitor view.
export const load: PageServerLoad = async () => {
    redirect(308, "/monitor");
};
