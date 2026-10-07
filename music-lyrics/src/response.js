/**
 * YouTube Music lyrics — response side (only runs on tagged lyrics responses).
 * Translates every non-Chinese lyric line to Simplified Chinese and writes it
 * under the original line. Chinese songs (simplified or traditional) and
 * songs without lyrics are left untouched. Any error -> original response.
 */
import { rewriteProtobufLyrics, rewriteJsonLyrics, describeProtobuf, analyseSong, shouldTranslateLine, combine } from "./lyrics.mjs";
import { translateLines } from "./translate.mjs";
import { readOptions } from "./options.mjs";

export const VERSION = "40.0";

function splitLines(kind, text) {
	return kind === "static" ? text.split("\n") : [text];
}

/** Core, independent of Surge globals (used by tests). */
export async function processLyricsBody(body, { position = "Forward", target = "zh-CN", translate = translateLines } = {}) {
	const isBinary = body instanceof Uint8Array;
	let json;
	if (!isBinary) {
		try {
			json = JSON.parse(body);
		} catch {
			return { status: "not-json", body };
		}
	}

	// 1. collect
	const collected = [];
	const collect = (kind, text) => {
		collected.push(...splitLines(kind, text));
		return undefined;
	};
	let mode = "anchor";
	let found = isBinary ? rewriteProtobufLyrics(body, collect).found : rewriteJsonLyrics(json, collect);
	if (isBinary && !found) {
		mode = "heuristic";
		found = rewriteProtobufLyrics(body, collect, { heuristic: true }).found;
	}
	if (!found || !collected.some(line => line.trim())) {
		return { status: "no-lyrics", body, tree: isBinary ? describeProtobuf(body).slice(0, 4000) : "" };
	}

	// 2. decide
	const song = analyseSong(collected);
	if (song.chinese) return { status: "chinese-skip", body, song };
	const wanted = collected.filter(line => shouldTranslateLine(line, song));
	if (!wanted.length) return { status: "nothing-to-translate", body, song };

	// 3. translate
	const { map, detected } = await translate(wanted, { target });
	if (detected.length && detected.every(code => /^zh/i.test(code))) return { status: "chinese-skip", body, song, detected };
	const render = line => (shouldTranslateLine(line, song) && map.has(line.trim()) ? combine(line, map.get(line.trim()), position) : line);
	const apply = (kind, text) => splitLines(kind, text).map(render).join("\n");

	// 4. write back
	let out;
	if (isBinary) out = rewriteProtobufLyrics(body, apply, { heuristic: mode === "heuristic" }).bytes;
	else {
		rewriteJsonLyrics(json, apply);
		out = JSON.stringify(json);
	}
	return { status: "translated", body: out, song, lines: collected.length, translated: map.size, mode };
}

if (typeof $response !== "undefined" && typeof $done === "function") {
	let finished = false;
	const finish = value => {
		if (finished) return;
		finished = true;
		clearTimeout(deadline);
		$done(value);
	};
	// Return the untouched response before Surge's 30-second script timeout.
	const deadline = setTimeout(() => {
		console.log("YTM lyrics: translation deadline reached, keeping original lyrics");
		finish({});
	}, 25000);
	(async () => {
		const options = readOptions();
		const result = await processLyricsBody($response.body, options);
		console.log(`YTM lyrics v${VERSION}: ${result.status}${result.lines ? `, lines=${result.lines}, translated=${result.translated}, mode=${result.mode}` : ""}`);
		if (result.status === "no-lyrics" && result.tree) console.log(`YTM lyrics: no lyrics found, response structure:\n${result.tree}`);
		const headers = { ...($response.headers ?? {}), "X-YTM-Lyrics": result.status };
		if (result.status === "translated") finish({ body: result.body, headers });
		else finish({ headers });
	})().catch(error => {
		console.log(`YTM lyrics error: ${error?.stack ?? error}`);
		finish({});
	});
}
