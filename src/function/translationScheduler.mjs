function normalizeRow(row) {
	if (Array.isArray(row)) return row.flat(Number.POSITIVE_INFINITY).join("");
	if (row === undefined || row === null) return "";
	return typeof row === "string" ? row : String(row);
}

/**
 * Keep Google Translate GET requests below a predictable encoded q length.
 * Row boundaries and order are preserved so each completed batch can be
 * written directly back to the matching YouTube timedtext paragraph.
 */
export function planTranslationBatches(rows, maxEncodedLength = 2400) {
	rows = Array.isArray(rows) ? rows.map(normalizeRow) : [];
	maxEncodedLength = Math.max(1, Number.parseInt(maxEncodedLength, 10) || 2400);
	const batches = [];
	let startIndex = 0;
	let batchRows = [];

	const commit = () => {
		if (!batchRows.length) return;
		const query = batchRows.join("\r");
		batches.push({
			startIndex,
			rows: batchRows,
			encodedLength: encodeURIComponent(query).length,
		});
		startIndex += batchRows.length;
		batchRows = [];
	};

	for (const row of rows) {
		const candidate = [...batchRows, row];
		if (batchRows.length && encodeURIComponent(candidate.join("\r")).length > maxEncodedLength) commit();
		batchRows.push(row);
		if (batchRows.length === 1 && encodeURIComponent(row).length > maxEncodedLength) commit();
	}
	commit();
	return batches;
}

/**
 * Translate small batches concurrently, but always return before the caller's
 * hard deadline. Incomplete or failed rows stay empty and are written back as
 * original-only captions instead of making the whole YouTube request fail.
 */
export async function translateBatchesWithinBudget(rows, translateBatch, options = {}) {
	rows = Array.isArray(rows) ? rows.map(normalizeRow) : [];
	if (typeof translateBatch !== "function") throw new TypeError("translateBatch must be a function");

	const maxEncodedLength = Math.max(1, Number.parseInt(options.maxEncodedLength, 10) || 2400);
	const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || 6);
	const budgetMs = Math.max(1, Number.parseInt(options.budgetMs, 10) || 6000);
	const batches = planTranslationBatches(rows, maxEncodedLength);
	const translations = Array(rows.length).fill("");
	const errors = [];
	const startedAt = Date.now();
	let nextBatchIndex = 0;
	let completedBatches = 0;
	let acceptingResults = true;
	let timer;

	if (!batches.length) {
		return {
			translations,
			batches,
			completedBatches: 0,
			failedBatches: 0,
			timedOut: false,
			elapsedMs: Date.now() - startedAt,
			errors,
		};
	}

	const worker = async () => {
		while (acceptingResults) {
			const batchIndex = nextBatchIndex;
			nextBatchIndex += 1;
			if (batchIndex >= batches.length) return;
			const batch = batches[batchIndex];
			try {
				let result = await translateBatch(batch.rows, { batch, batchIndex, totalBatches: batches.length });
				if (!acceptingResults) return;
				result = Array.isArray(result) ? result.map(normalizeRow) : [];
				if (result.length !== batch.rows.length) {
					throw new Error(`translation batch ${batchIndex + 1} row mismatch: expected ${batch.rows.length}, received ${result.length}`);
				}
				result.forEach((translation, rowIndex) => {
					translations[batch.startIndex + rowIndex] = translation;
				});
				completedBatches += 1;
			} catch (error) {
				if (!acceptingResults) return;
				errors.push(error instanceof Error ? error.message : String(error));
			}
		}
	};

	const workers = Promise.all(Array.from(
		{ length: Math.min(concurrency, batches.length) },
		() => worker(),
	));
	const outcome = await Promise.race([
		workers.then(() => "completed"),
		new Promise(resolve => {
			timer = setTimeout(() => resolve("deadline"), budgetMs);
		}),
	]);
	clearTimeout(timer);
	acceptingResults = false;

	return {
		translations,
		batches,
		completedBatches,
		failedBatches: batches.length - completedBatches,
		timedOut: outcome === "deadline",
		elapsedMs: Date.now() - startedAt,
		errors,
	};
}
