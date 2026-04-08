/** @type {import('tailwindcss').Config} */
module.exports = {
    // Scope all utilities to both gallery roots so they work inside yarl's portal tree.
    // #comfy-gallery-yarl-root is a sibling of #comfy-gallery-root at document.body level;
    // yarl portals into it, and plugin content must have full Tailwind coverage there too.
    important: ':is(#comfy-gallery-root, #comfy-gallery-yarl-root)',
};
