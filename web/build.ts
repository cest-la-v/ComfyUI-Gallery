import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";

// Only clean the assets output directory, not the entire dist/
// (dist/ also contains api.json used by the dev server mock)
await rm("dist/assets", { recursive: true, force: true });

const result = await Bun.build({
    entrypoints: ["src/main.tsx"],
    outdir: "dist",
    target: "browser",
    minify: true,
    plugins: [tailwind],
    naming: {
        entry: "assets/comfy-ui-gallery.[ext]",
        chunk: "assets/comfy-ui-gallery-[name].js",
        asset: "assets/comfy-ui-gallery.[ext]",
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
});

if (!result.success) {
    for (const msg of result.logs) {
        console.error(msg);
    }
    process.exit(1);
}

for (const output of result.outputs) {
    const rel = output.path.replace(process.cwd() + "/", "");
    console.log(`  ${rel}  ${(output.size / 1024).toFixed(1)} KB`);
}
