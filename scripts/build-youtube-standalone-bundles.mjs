import { readFile, writeFile } from "node:fs/promises";

const bundles = [
	["vendor/dualsubs-youtube-v1.5.11/request.bundle.js", "request.youtube-standalone-v18.bundle.js"],
	["vendor/dualsubs-youtube-v1.5.11/response.bundle.js", "response.youtube-standalone-v18.bundle.js"],
];

for (const [sourcePath, outputPath] of bundles) {
	const source = await readFile(sourcePath, "utf8");
	const output = source.replaceAll("DualSubs", "Hey-sayiwanna");

	if (output.includes("DualSubs")) {
		throw new Error(`${outputPath} still contains the legacy DualSubs namespace`);
	}

	await writeFile(outputPath, output);
	console.log(`Built ${outputPath}`);
}
