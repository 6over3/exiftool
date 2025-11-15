import { beforeAll, describe, expect, it } from "vitest";
import { parseMetadata, writeMetadata } from "../src/index";

describe("EXIF Unicode Character Handling", () => {
	let testJpegFile: File;

	beforeAll(async () => {
		// Create a minimal JPEG file for testing
		// This is a 1x1 pixel red JPEG
		const jpegData = new Uint8Array([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
			0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
			0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
			0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
			0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
			0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
			0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
			0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
			0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x03, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
			0x7f, 0x80, 0xff, 0xd9,
		]);
		testJpegFile = new File([jpegData], "test.jpg", { type: "image/jpeg" });
	});

	describe("Korean (한국어) Character Handling", () => {
		it("should correctly preserve Korean text in Artist field", async () => {
			const koreanText = "안녕하세요";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: koreanText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			expect(writeResult.data).toBeDefined();

			if (!writeResult.data) {
				throw new Error("Write operation failed");
			}

			const modified = new File([writeResult.data], "test-korean.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			expect(readResult.data).toBeDefined();

			if (!readResult.data) {
				throw new Error("Read operation failed");
			}

			const metadata = JSON.parse(readResult.data)[0];
			expect(metadata.Artist).toBe(koreanText);
			expect(metadata.Artist).not.toMatch(/[�]/); // Should not contain replacement character
		});

		it("should handle multiple Korean metadata fields", async () => {
			const metadata = {
				Artist: "김철수",
				ImageDescription: "서울의 아름다운 풍경",
				Copyright: "© 2024 한국 사진가 협회",
			};

			const writeResult = await writeMetadata(testJpegFile, metadata, {
				args: [],
			});

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-korean-multi.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.Artist).toBe(metadata.Artist);
			expect(parsed.ImageDescription).toBe(metadata.ImageDescription);
			expect(parsed.Copyright).toBe(metadata.Copyright);
		});

		it("should handle Korean text with special characters", async () => {
			const koreanText = "안녕하세요! 반갑습니다? (한국어)";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					ImageDescription: koreanText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-korean-special.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.ImageDescription).toBe(koreanText);
		});
	});

	describe("Japanese (日本語) Character Handling", () => {
		it("should correctly preserve Japanese text in Artist field", async () => {
			const japaneseText = "こんにちは世界";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: japaneseText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-japanese.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.Artist).toBe(japaneseText);
			expect(parsed.Artist).not.toMatch(/[�]/);
		});

		it("should handle mixed Hiragana, Katakana, and Kanji", async () => {
			const japaneseText = "ひらがな カタカナ 漢字";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					ImageDescription: japaneseText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-japanese-mixed.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.ImageDescription).toBe(japaneseText);
		});
	});

	describe("Chinese (中文) Character Handling", () => {
		it("should correctly preserve Simplified Chinese text", async () => {
			const chineseText = "你好世界";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: chineseText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-chinese.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.Artist).toBe(chineseText);
			expect(parsed.Artist).not.toMatch(/[�]/);
		});

		it("should correctly preserve Traditional Chinese text", async () => {
			const chineseText = "繁體中文測試";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: chineseText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-chinese-trad.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.Artist).toBe(chineseText);
		});
	});

	describe("Mixed Unicode Character Handling", () => {
		it("should handle English text (baseline test)", async () => {
			const englishText = "Hello World";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: englishText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-english.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.Artist).toBe(englishText);
		});

		it("should handle mixed language metadata", async () => {
			const mixedText = "Hello 안녕하세요 こんにちは 你好";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					ImageDescription: mixedText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-mixed.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.ImageDescription).toBe(mixedText);
		});

		it("should handle emoji and extended Unicode characters", async () => {
			const emojiText = "📷 Photo by 김철수 🌸";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: emojiText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-emoji.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.Artist).toBe(emojiText);
		});
	});

	describe("Byte Length Validation", () => {
		it("should preserve correct byte representation for Korean text", async () => {
			const koreanText = "안녕하세요";
			const expectedByteLength = new TextEncoder().encode(koreanText).length;

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: koreanText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-bytes.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			const actualByteLength = new TextEncoder().encode(parsed.Artist).length;

			expect(actualByteLength).toBe(expectedByteLength);
			expect(parsed.Artist.length).toBe(koreanText.length); // Character count
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty strings", async () => {
			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: "",
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-empty.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			// ExifTool doesn't write empty tags, so the tag won't exist
			expect(parsed.Artist).toBeUndefined();
		});

		it("should handle very long Korean text", async () => {
			const longText = "안녕하세요".repeat(50);

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					ImageDescription: longText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-long.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];
			expect(parsed.ImageDescription).toBe(longText);
		});

		it("should detect corruption by checking for replacement characters", async () => {
			const koreanText = "안녕하세요";

			const writeResult = await writeMetadata(
				testJpegFile,
				{
					Artist: koreanText,
				},
				{
					args: [],
				},
			);

			expect(writeResult.success).toBe(true);
			if (!writeResult.data) throw new Error("Write failed");

			const modified = new File([writeResult.data], "test-corruption.jpg");
			const readResult = await parseMetadata(modified, {
				args: ["-json"],
			});

			expect(readResult.success).toBe(true);
			if (!readResult.data) throw new Error("Read failed");

			const parsed = JSON.parse(readResult.data)[0];

			// Check for common corruption patterns
			expect(parsed.Artist).not.toContain("�"); // Unicode replacement character
			expect(parsed.Artist).not.toContain("HUX8"); // Specific corruption mentioned in issue
			// Check the text is actually Korean (at least contains some Hangul characters)
			expect(parsed.Artist).toMatch(/[\u3131-\uD79D]/);
		});
	});
});
