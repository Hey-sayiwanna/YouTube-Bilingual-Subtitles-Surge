/**
 * Minimal, lossless protobuf wire-format editor.
 *
 * We never decode the whole YouTube response into a schema (unknown fields
 * would be at risk). Instead a message is split into its raw fields; only the
 * string fields we translate are replaced and the length prefixes of their
 * parent messages are recomputed. Every other byte is copied unchanged.
 */

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

function readVarint(bytes, position, end) {
	let result = 0;
	let multiplier = 1;
	for (let index = 0; index < 10; index += 1) {
		if (position >= end) return null;
		const byte = bytes[position];
		position += 1;
		result += (byte & 0x7f) * multiplier;
		if (byte < 0x80) return { value: result, position };
		multiplier *= 128;
	}
	return null;
}

export function encodeVarint(value) {
	const out = [];
	let rest = value;
	while (rest >= 0x80) {
		out.push((rest % 128) | 0x80);
		rest = Math.floor(rest / 128);
	}
	out.push(rest);
	return Uint8Array.from(out);
}

/**
 * Split a message into fields. Returns null when the bytes are not a
 * well-formed message (used to tell sub-messages from strings).
 * field = { no, wire, tagStart, lengthStart, valueStart, valueEnd, value }
 */
export function parseMessage(bytes, start = 0, end = bytes.length) {
	const fields = [];
	let position = start;
	while (position < end) {
		const tagStart = position;
		const tag = readVarint(bytes, position, end);
		if (!tag) return null;
		position = tag.position;
		const no = Math.floor(tag.value / 8);
		const wire = tag.value % 8;
		if (no < 1 || no > 536870911) return null;
		if (wire === WIRE_VARINT) {
			const value = readVarint(bytes, position, end);
			if (!value) return null;
			fields.push({ no, wire, tagStart, valueStart: position, valueEnd: value.position, value: value.value });
			position = value.position;
		} else if (wire === WIRE_I64 || wire === WIRE_I32) {
			const size = wire === WIRE_I64 ? 8 : 4;
			if (position + size > end) return null;
			fields.push({ no, wire, tagStart, valueStart: position, valueEnd: position + size });
			position += size;
		} else if (wire === WIRE_LEN) {
			const lengthStart = position;
			const length = readVarint(bytes, position, end);
			if (!length) return null;
			position = length.position;
			if (position + length.value > end) return null;
			fields.push({ no, wire, tagStart, lengthStart, valueStart: position, valueEnd: position + length.value });
			position += length.value;
		} else {
			return null; // groups (3/4) and invalid wire types are not used by YouTube
		}
	}
	return fields;
}

/** Rebuild a message, replacing the values of some length-delimited fields. */
export function rebuildMessage(bytes, fields, replacements) {
	const parts = [];
	let size = 0;
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index];
		const replacement = replacements.get(index);
		if (replacement && field.wire === WIRE_LEN) {
			const head = bytes.subarray(field.tagStart, field.lengthStart);
			const length = encodeVarint(replacement.length);
			parts.push(head, length, replacement);
			size += head.length + length.length + replacement.length;
		} else {
			const raw = bytes.subarray(field.tagStart, field.valueEnd);
			parts.push(raw);
			size += raw.length;
		}
	}
	const out = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

export function fieldValue(bytes, field) {
	return bytes.subarray(field.valueStart, field.valueEnd);
}

/* ---------------- UTF-8 (no TextEncoder dependency, works in JSC) ---------------- */

export function utf8Decode(bytes) {
	let out = "";
	let index = 0;
	while (index < bytes.length) {
		const b0 = bytes[index];
		let code;
		let size;
		if (b0 < 0x80) { code = b0; size = 1; }
		else if (b0 >= 0xc2 && b0 < 0xe0) { code = b0 & 0x1f; size = 2; }
		else if (b0 >= 0xe0 && b0 < 0xf0) { code = b0 & 0x0f; size = 3; }
		else if (b0 >= 0xf0 && b0 < 0xf5) { code = b0 & 0x07; size = 4; }
		else return null;
		if (index + size > bytes.length) return null;
		for (let k = 1; k < size; k += 1) {
			const b = bytes[index + k];
			if ((b & 0xc0) !== 0x80) return null;
			code = code * 64 + (b & 0x3f);
		}
		if ((size === 3 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) || (size === 4 && (code < 0x10000 || code > 0x10ffff))) return null;
		out += String.fromCodePoint(code);
		index += size;
	}
	return out;
}

export function utf8Encode(text) {
	const out = [];
	for (const character of String(text)) {
		const code = character.codePointAt(0);
		if (code < 0x80) out.push(code);
		else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
		else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
		else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
	}
	return Uint8Array.from(out);
}
