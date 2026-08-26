/**
 * Selected library items, keyed by Riven's own item id.
 *
 * Ids are STRINGS: `GET /api/v1/items` serialises `id` as `"59695"`, and both producers
 * (the library page loader and `fetch_all_matching_ids`) pass that value through untouched.
 * This used to be typed `number[]` while holding strings, which made `has()`/`toggle()`
 * quietly dependent on nobody ever coercing on one side only.
 */
export class ItemStore {
    #selectedItems = $state<string[]>([]);

    get items() {
        return this.#selectedItems;
    }

    get count() {
        return this.#selectedItems.length;
    }

    clear() {
        this.#selectedItems = [];
    }

    has(id: string): boolean {
        return this.#selectedItems.indexOf(id) > -1;
    }

    toggle(id: string) {
        const index = this.#selectedItems.indexOf(id);
        if (index > -1) {
            this.#selectedItems.splice(index, 1);
        } else {
            this.#selectedItems.push(id);
        }
    }
}
