/**
 * YouTube Music lyrics — request side.
 * Marks the lyrics request (browseId MPLYt_…) with `ytmLyrics=1` so that the
 * response script only ever runs on lyrics, never on the home feed.
 *
 * Evade (default on): Surge runs only ONE http-response script per request.
 * "Youtube (Music) Enhance" (youtube.response) matches every
 * youtubei.googleapis.com/youtubei/v1/browse URL and would take the lyrics
 * response. Writing the default port explicitly (…googleapis.com:443/…) is
 * the same request for the server but no longer matches that pattern.
 */
import { gunzipSync } from "fflate";
import { readOptions, TAG_PARAM } from "./options.mjs";

const NEEDLE = [0x4d, 0x50, 0x4c, 0x59, 0x74, 0x5f]; // "MPLYt_"

function containsNeedle(bytes) {
	outer: for (let i = 0; i + NEEDLE.length <= bytes.length; i += 1) {
		for (let k = 0; k < NEEDLE.length; k += 1) if (bytes[i + k] !== NEEDLE[k]) continue outer;
		return true;
	}
	return false;
}

function isLyricsRequest(body) {
	if (typeof body === "string") return body.includes("MPLYt_");
	if (!(body instanceof Uint8Array) || !body.length) return false;
	if (containsNeedle(body)) return true;
	if (body[0] === 0x1f && body[1] === 0x8b) {
		try {
			return containsNeedle(gunzipSync(body));
		} catch {
			return false;
		}
	}
	return false;
}

export function tagLyricsUrl(url, evade) {
	let out = url;
	if (!new RegExp(`[?&]${TAG_PARAM}=`).test(out)) out += `${out.includes("?") ? "&" : "?"}${TAG_PARAM}=1`;
	if (evade) out = out.replace(/^https:\/\/youtubei\.googleapis\.com\//, "https://youtubei.googleapis.com:443/");
	return out;
}

if (typeof $request !== "undefined" && typeof $done === "function") {
	try {
		if (isLyricsRequest($request.body)) {
			const url = tagLyricsUrl($request.url, readOptions().evade);
			console.log(`YTM lyrics: tagged lyrics request -> ${url.split("?")[0]}`);
			$done({ url });
		} else $done({});
	} catch (error) {
		console.log(`YTM lyrics request error: ${error?.message ?? error}`);
		$done({});
	}
}

export { isLyricsRequest };
