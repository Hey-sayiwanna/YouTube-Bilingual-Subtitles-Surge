import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import NodePolyfillPlugin from "node-polyfill-webpack-plugin";
import pkg from "./package.json" with { type: "json" };

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// v40 updates only the English bundle; CJK/other retain their v39 filenames.
// The three independent bundles share all code and differ only in
// which language models are compiled in (src/profiles/*.mjs):
//   en    -> English model
//   cjk   -> Japanese + Korean models
//   other -> no model (generic standard for every other language)
// YouTube.Bilingual.sgmodule routes each timedtext request by its lang= parameter.
const bundles = { en: "en", cjk: "cjk", other: "other" };

export default Object.entries(bundles).map(([name, profile]) =>
	defineConfig({
		name,
		entry: { [`Translate.response.youtube-fix-v${name === "en" ? 40 : 39}-${name}`]: "./src/YouTube.Translate.response.js" },
		resolve: { alias: { "asr-profiles": path.join(projectRoot, "src/profiles", `${profile}.mjs`) } },
		output: {
			path: projectRoot,
			filename: "[name].bundle.js",
			chunkFormat: false,
			clean: false,
			library: { type: "module" },
		},
		plugins: [
			new NodePolyfillPlugin(),
			new rspack.BannerPlugin({
				banner: `console.log('Hey-sayiwanna YouTube Bilingual v${name === "en" ? pkg.version : "39.0.0"} [${name}]');`,
				raw: true,
			}),
		],
		devtool: false,
		performance: false,
	}),
);
