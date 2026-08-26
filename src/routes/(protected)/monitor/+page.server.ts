import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ fetch, locals }) => {
    const headers = { "x-api-key": locals.apiKey };

    const [queueResp, runnersResp] = await Promise.all([
        fetch(`${locals.backendUrl}/api/v1/events/queue`, { headers }),
        // Queue is the default Monitor view, so it carries the cross-tab
        // overview. A runners failure must not blank the queue, hence the
        // tolerated null below.
        fetch(`${locals.backendUrl}/api/v1/runners?limit=1`, { headers })
    ]);

    if (!queueResp.ok) {
        error(500, `Failed to read queue (HTTP ${queueResp.status})`);
    }

    const queue = await queueResp.json();
    const runners = runnersResp.ok ? await runnersResp.json() : null;

    return {
        ...queue,
        overview: runners
            ? {
                  runner_count: runners.runners.length,
                  runners_failing: runners.runners.filter(
                      (r: { last_ok: boolean | null }) => r.last_ok === false
                  ).length,
                  tasks_pending: runners.task_counts?.pending ?? 0,
                  tasks_failed: runners.task_counts?.failed ?? 0
              }
            : null
    };
};
