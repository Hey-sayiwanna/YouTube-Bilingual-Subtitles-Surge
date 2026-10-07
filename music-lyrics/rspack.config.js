// Independent build for the YouTube Music lyrics module (does not touch the subtitle bundles).
//   npm run build:music
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "40.0";

export default defineConfig({
	context: here,
	entry: {
		"YouTubeMusic.Lyrics.request": "./src/request.js",
		"YouTubeMusic.Lyrics.response": "./src/response.js",
	},
	output: {
		path: path.resolve(here, ".."),
		filename: "[name].bundle.js",
		chunkFormat: false,
		clean: false,
		iife: true, // classic script for Surge (no export statements)
	},
	plugins: [
		new rspack.BannerPlugin({ banner: `/* Hey-sayiwanna YouTube Music Lyrics v${VERSION} */`, raw: true, stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT }),
		new rspack.BannerPlugin({ banner: fs.readFileSync(path.join(here, "licenses/fflate.LICENSE.txt"), "utf8"), stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT }),
	],
	optimization: { minimize: true },
	devtool: false,
	performance: false,
});
