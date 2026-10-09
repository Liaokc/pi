import type { ProviderClassifier, ProviderEnv, ProviderHeaders, ProviderStreams } from "../types.ts";

const CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID";
const CLOUDFLARE_GATEWAY_ID = "CLOUDFLARE_GATEWAY_ID";
/** REST API origin; the trailing slash keeps the prefix from matching lookalike hosts. */
const CLOUDFLARE_REST_API_ORIGIN = "https://api.cloudflare.com/";

export function resolveCloudflareModel<TModel extends { baseUrl: string }>(
	model: TModel,
	env: ProviderEnv | undefined,
): TModel {
	if (!env) return model;
	const baseUrl = model.baseUrl
		.replaceAll(`{${CLOUDFLARE_ACCOUNT_ID}}`, env[CLOUDFLARE_ACCOUNT_ID] ?? `{${CLOUDFLARE_ACCOUNT_ID}}`)
		.replaceAll(`{${CLOUDFLARE_GATEWAY_ID}}`, env[CLOUDFLARE_GATEWAY_ID] ?? `{${CLOUDFLARE_GATEWAY_ID}}`);
	return baseUrl === model.baseUrl ? model : { ...model, baseUrl };
}

/**
 * gateway.ai.cloudflare.com passthroughs authenticate with cf-aig-authorization,
 * but the catalog-aware REST API at api.cloudflare.com requires the standard
 * Authorization header. Swap the gateway credential onto Authorization when a
 * REST-routed model is dispatched so one provider credential serves both.
 * https://developers.cloudflare.com/ai-gateway/configuration/authentication/
 */
function resolveCloudflareRestAuthHeaders<TOptions extends { headers?: ProviderHeaders }>(
	model: { baseUrl: string },
	options: TOptions | undefined,
): TOptions | undefined {
	const headers = options?.headers;
	if (!headers || !model.baseUrl.startsWith(CLOUDFLARE_REST_API_ORIGIN)) return options;

	let gatewayToken: string | undefined;
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === "cf-aig-authorization" && typeof value === "string") gatewayToken = value;
	}
	if (!gatewayToken) return options;

	const resolved: ProviderHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		const lowerName = name.toLowerCase();
		if (lowerName === "cf-aig-authorization" || lowerName === "authorization") continue;
		resolved[name] = value;
	}
	resolved.Authorization = gatewayToken;
	return { ...options, headers: resolved };
}

/**
 * Wrap an API implementation so Cloudflare account/gateway endpoint
 * placeholders materialize from the resolved provider env before dispatch.
 */
export function cloudflareStreams(streams: ProviderStreams): ProviderStreams {
	return {
		stream: (model, context, options) =>
			streams.stream(
				resolveCloudflareModel(model, options?.env),
				context,
				resolveCloudflareRestAuthHeaders(model, options),
			),
		streamSimple: (model, context, options) =>
			streams.streamSimple(
				resolveCloudflareModel(model, options?.env),
				context,
				resolveCloudflareRestAuthHeaders(model, options),
			),
	};
}

/** Classifier counterpart of {@link cloudflareStreams}. */
export function cloudflareClassifier(classifier: ProviderClassifier): ProviderClassifier {
	return {
		classify: (model, context, options) =>
			classifier.classify(resolveCloudflareModel(model, options?.env), context, options),
	};
}
