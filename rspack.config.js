import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import NodePolyfillPlugin from "node-polyfill-webpack-plugin";
import pkg from "./package.json" with { type: "json" };

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	entry: {
		"Translate.response.youtube-fix-v20": "./src/YouTube.Translate.response.js",
	},
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
			banner: `console.log('Hey-sayiwanna YouTube Bilingual v${pkg.version}');`,
			raw: true,
		}),
	],
	devtool: false,
	performance: false,
});
