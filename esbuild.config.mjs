import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const purifyContent = fs.readFileSync("./src/purify.min.js", "utf8");

esbuild
  .build({
    entryPoints: ["./src/index.js"],
    bundle: true,
    outfile: "dist/bundle.cjs",
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["playwright-core", "express", "fs", "path", "os"],
    plugins: [
      {
        name: "inline-purify",
        setup(build) {
          // Handle purify.min.js import
          build.onResolve({ filter: /purify\.min\.js$/ }, (args) => {
            return {
              path: args.path,
              namespace: "purify-ns",
            };
          });

          build.onLoad({ filter: /.*/, namespace: "purify-ns" }, () => {
            return {
              contents: `export default ${JSON.stringify(purifyContent)};`,
              loader: "js",
            };
          });

          build.onResolve({ filter: /^playwright-core/ }, (args) => {
            return { external: true };
          });
        },
      },
    ],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    sourcemap: false,
  })
  .catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
