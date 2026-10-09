import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL, CLOUDFLARE_AI_GATEWAY_REST_BASE_URL } from "../src/api/cloudflare.ts";
import type { Api, Model } from "../src/types.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function generateGatewayModels(): Record<string, Model<Api>> {
	const root = mkdtempSync(join(tmpdir(), "pi-cloudflare-gateway-generation-"));
	temporaryRoots.push(root);
	const preloadPath = join(root, "mock-catalog.mjs");
	const outputPath = join(root, "catalog");
	const catalog = {
		"cloudflare-ai-gateway": {
			models: {
				"openai/gpt-fixture": { id: "gpt-fixture", tool_call: true },
				"unbiased/pareto": { id: "pareto", tool_call: true },
			},
		},
	};
	writeFileSync(
		preloadPath,
		`const catalog = ${JSON.stringify(catalog)};\n` +
			`globalThis.fetch = async (input) => {\n` +
			`  const url = String(input);\n` +
			`  if (url === "https://models.dev/api.json") return Response.json(catalog);\n` +
			`  if (url === "https://models.dev/models.json?type=decision") return Response.json({ "typesafe/jev-latest": { name: "Jev", type: "decision", limit: { context: 64000, output: 0 } } });\n` +
			`  if (url.startsWith("https://openrouter.ai/api/v1/models") || url === "https://ai-gateway.vercel.sh/v1/models") return Response.json({ data: [] });\n` +
			`  if (url === "https://radius.pi.dev/v1/config") return Response.json({ baseUrl: "https://radius.pi.dev", models: [{ id: "test", name: "Test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 4096 }] });\n` +
			`  throw new Error(\`Unexpected fetch: \${url}\`);\n` +
			`};\n`,
	);
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			pathToFileURL(preloadPath).href,
			"scripts/generate-models.ts",
			"--json-only",
			"--json-output",
			outputPath,
		],
		{ cwd: packageRoot, encoding: "utf8", timeout: 10_000 },
	);
	expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
	expect(result.stderr).toBe("");
	return JSON.parse(readFileSync(join(outputPath, "providers/cloudflare-ai-gateway.json"), "utf8")) as Record<
		string,
		Model<Api>
	>;
}

describe("Cloudflare AI Gateway model generation", () => {
	// Regression test for https://github.com/earendil-works/pi/issues/10539
	it("routes upstreams without a gateway passthrough over the catalog-aware REST API", () => {
		const models = generateGatewayModels();

		const pareto = models["unbiased/pareto"];
		expect(pareto, "non-passthrough upstreams must not be dropped from the catalog").toBeDefined();
		expect(pareto.api).toBe("openai-completions");
		expect(pareto.baseUrl).toBe(CLOUDFLARE_AI_GATEWAY_REST_BASE_URL);

		// Passthrough upstreams keep their dedicated endpoints.
		const fixture = models["gpt-fixture"];
		expect(fixture, "openai passthrough upstream must still be cataloged").toBeDefined();
		expect(fixture.api).toBe("openai-responses");
		expect(fixture.baseUrl).toBe(CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL);
	});
});
