import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
	plugins: [
		{
			name: "raw-text-loader",
			transform(code, id) {
				if (id.endsWith("/src/exiftool")) {
					return {
						code: `export default ${JSON.stringify(code)};`,
						map: null,
					};
				}
			},
		},
	],
});
