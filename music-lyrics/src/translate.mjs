/**
 * Google Translate (gtx) for lyric lines.
 * - identical lines (choruses) are translated once
 * - lines are sent in batches joined by "\n"; if Google returns a different
 *   number of lines, that batch is retried line by line
 * - bounded concurrency, retries, never throws (missing lines stay untranslated)
 */

function httpGet(url, timeout = 10) {
	return new Promise((resolve, reject) => {
		$httpClient.get({ url, timeout, headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 YTMusic-Lyrics/1.0" } }, (error, response, body) => {
			if (error) reject(error);
			else if (response && response.status >= 400) reject(new Error(`HTTP ${response.status}`));
			else resolve(body);
		});
	});
}

async function retry(task, times = 2, wait = 400) {
	try {
		return await task();
	} catch (error) {
		if (times <= 0) throw error;
		await new Promise(resolve => setTimeout(resolve, wait));
		return retry(task, times - 1, wait * 2);
	}
}

async function googleTranslate(lines, target) {
	const q = encodeURIComponent(lines.join("\n"));
	const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=${target}&q=${q}`;
	const body = JSON.parse(await retry(() => httpGet(url)));
	const text = Array.isArray(body?.[0]) ? body[0].map(part => part?.[0] ?? "").join("") : "";
	return { lines: text.split("\n"), detected: typeof body?.[2] === "string" ? body[2] : "" };
}

async function mapLimit(items, limit, mapper) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			out[index] = await mapper(items[index], index);
		}
	}));
	return out;
}

/**
 * @param {string[]} lines unique source lines
 * @returns {Promise<{map: Map<string,string>, detected: string[]}>}
 */
export async function translateLines(lines, { target = "zh-CN", maxEncoded = 1800, concurrency = 3 } = {}) {
	const unique = [...new Set(lines.map(line => line.trim()).filter(Boolean))];
	const batches = [];
	let current = [];
	let size = 0;
	for (const line of unique) {
		const encoded = encodeURIComponent(line).length + 3;
		if (current.length && size + encoded > maxEncoded) {
			batches.push(current);
			current = [];
			size = 0;
		}
		current.push(line);
		size += encoded;
	}
	if (current.length) batches.push(current);

	const map = new Map();
	const detected = [];
	await mapLimit(batches, concurrency, async batch => {
		try {
			const result = await googleTranslate(batch, target);
			if (result.detected) detected.push(result.detected);
			if (result.lines.length === batch.length) {
				batch.forEach((line, index) => map.set(line, result.lines[index].trim()));
				return;
			}
		} catch (error) {
			console.log(`YTM lyrics: batch failed (${error?.message ?? error}), retry line by line`);
		}
		await mapLimit(batch, concurrency, async line => {
			try {
				const result = await googleTranslate([line], target);
				map.set(line, result.lines.join(" ").trim());
			} catch {
				/* keep untranslated */
			}
		});
	});
	return { map, detected };
}
