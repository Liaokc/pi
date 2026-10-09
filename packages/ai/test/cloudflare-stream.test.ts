import { describe, expect, it } from "vitest";
import { cloudflareStreams } from "../src/providers/cloudflare-stream.ts";
import type { Api, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<Api> = {
	id: "model",
	name: "model",
	api: "openai-completions",
	provider: "cloudflare-ai-gateway",
	baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const context = normalizeContext({ messages: [] });

const restModel: Model<Api> = {
	...model,
	baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
};

const gatewayAuthHeaders = {
	"cf-aig-authorization": "Bearer cf-token",
	Authorization: null,
	"x-api-key": null,
} as const;

describe("Cloudflare provider streams", () => {
	it("materializes the model endpoint before dispatch", () => {
		const captured: string[] = [];
		const streams = cloudflareStreams({
			stream: (requestModel) => {
				captured.push(requestModel.baseUrl);
				return new AssistantMessageEventStream();
			},
			streamSimple: (requestModel) => {
				captured.push(requestModel.baseUrl);
				return new AssistantMessageEventStream();
			},
		});
		const env = {
			CLOUDFLARE_ACCOUNT_ID: "account",
			CLOUDFLARE_GATEWAY_ID: "gateway",
		};

		streams.stream(model, context, { env });
		streams.streamSimple(model, context, { env });

		expect(captured).toEqual([
			"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
			"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
		]);
	});

	it("keeps placeholders when the provider env does not resolve them", () => {
		let captured: string | undefined;
		const streams = cloudflareStreams({
			stream: (requestModel) => {
				captured = requestModel.baseUrl;
				return new AssistantMessageEventStream();
			},
			streamSimple: (requestModel) => {
				captured = requestModel.baseUrl;
				return new AssistantMessageEventStream();
			},
		});

		streams.streamSimple(model, context, {});

		expect(captured).toBe(model.baseUrl);
	});

	it("moves the gateway credential onto Authorization for REST API models", () => {
		const captured: Array<Record<string, string | null> | undefined> = [];
		const streams = cloudflareStreams({
			stream: (_requestModel, _context, options) => {
				captured.push(options?.headers);
				return new AssistantMessageEventStream();
			},
			streamSimple: (_requestModel, _context, options) => {
				captured.push(options?.headers);
				return new AssistantMessageEventStream();
			},
		});

		streams.stream(restModel, context, { headers: { ...gatewayAuthHeaders } });
		streams.streamSimple(restModel, context, { headers: { ...gatewayAuthHeaders } });

		expect(captured).toEqual([
			{ "x-api-key": null, Authorization: "Bearer cf-token" },
			{ "x-api-key": null, Authorization: "Bearer cf-token" },
		]);
	});

	it("keeps the gateway credential header for passthrough models", () => {
		let captured: Record<string, string | null> | undefined;
		const streams = cloudflareStreams({
			stream: (_requestModel, _context, options) => {
				captured = options?.headers;
				return new AssistantMessageEventStream();
			},
			streamSimple: (_requestModel, _context, options) => {
				captured = options?.headers;
				return new AssistantMessageEventStream();
			},
		});

		streams.streamSimple(model, context, { headers: { ...gatewayAuthHeaders } });

		expect(captured).toEqual({ ...gatewayAuthHeaders });
	});

	it("leaves REST API requests untouched without a gateway credential header", () => {
		let captured: Record<string, string | null> | undefined;
		const streams = cloudflareStreams({
			stream: (_requestModel, _context, options) => {
				captured = options?.headers;
				return new AssistantMessageEventStream();
			},
			streamSimple: (_requestModel, _context, options) => {
				captured = options?.headers;
				return new AssistantMessageEventStream();
			},
		});

		streams.streamSimple(restModel, context, { headers: { "x-custom": "value" } });

		expect(captured).toEqual({ "x-custom": "value" });
	});
});
