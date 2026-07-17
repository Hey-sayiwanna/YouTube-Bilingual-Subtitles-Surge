import assert from "node:assert/strict";
import {
	planTranslationBatches,
	translateBatchesWithinBudget,
} from "../src/function/translationScheduler.mjs";

const capturedLikeRows = Array.from(
	{ length: 231 },
	(_, index) => `자동 생성 자막 ${index + 1}: 화면에 표시할 문장입니다.`,
);
const batches = planTranslationBatches(capturedLikeRows, 2400);
assert.ok(batches.length > 2);
assert.ok(batches.every(batch => batch.encodedLength <= 2400));
assert.deepEqual(batches.flatMap(batch => batch.rows), capturedLikeRows);
assert.deepEqual(batches.map(batch => batch.startIndex), batches.map((_, index) => batches.slice(0, index).reduce((sum, batch) => sum + batch.rows.length, 0)));

const complete = await translateBatchesWithinBudget(
	capturedLikeRows,
	async rows => rows.map(row => `翻译：${row}`),
	{ maxEncodedLength: 2400, concurrency: 6, budgetMs: 1000 },
);
assert.equal(complete.timedOut, false);
assert.equal(complete.completedBatches, batches.length);
assert.equal(complete.failedBatches, 0);
assert.equal(complete.translations.length, capturedLikeRows.length);
assert.equal(complete.translations[230], `翻译：${capturedLikeRows[230]}`);

const partialRows = Array.from({ length: 18 }, (_, index) => `긴 자동 자막 ${index + 1}`);
const partial = await translateBatchesWithinBudget(
	partialRows,
	(rows, { batchIndex }) => batchIndex === 0
		? Promise.resolve(rows.map(row => `完成：${row}`))
		: new Promise(resolve => setTimeout(() => resolve(rows.map(row => `太迟：${row}`)), 120)),
	{ maxEncodedLength: 90, concurrency: 2, budgetMs: 30 },
);
assert.equal(partial.timedOut, true);
assert.ok(partial.completedBatches > 0);
assert.ok(partial.completedBatches < partial.batches.length);
assert.ok(partial.translations.some(Boolean));
assert.ok(partial.translations.some(text => !text));
assert.ok(partial.elapsedMs < 100);

const deadline = await translateBatchesWithinBudget(
	partialRows,
	rows => new Promise(resolve => setTimeout(() => resolve(rows), 120)),
	{ maxEncodedLength: 90, concurrency: 2, budgetMs: 25 },
);
assert.equal(deadline.timedOut, true);
assert.equal(deadline.completedBatches, 0);
assert.equal(deadline.failedBatches, deadline.batches.length);
assert.ok(deadline.translations.every(text => text === ""));
assert.ok(deadline.elapsedMs < 100);

console.log(JSON.stringify({
	encodedLengthBatching: "passed",
	rowOrderPreserved: "passed",
	boundedConcurrency: "passed",
	partialDeadlineFallback: "passed",
	originalDeadlineFallback: "passed",
}, null, 2));
