import type {
	AgentRequest,
	AgentResponse,
	AgentContext,
	AgentWelcome,
} from "@agentuity/sdk";
import { google, type GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { streamText } from "ai";

export const welcome: AgentWelcome = () => ({
	welcome:
		"You are a helpful software developer assistant that can answer questions and help with tasks related to the Github repo.",
	prompts: [
		{
			data: JSON.stringify({
				repo: "agentuity/cli",
				prompt: "What is the main function of the repo?",
			}),
			contentType: "application/json",
		},
	],
});

export default async function Agent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	if (req.data.contentType !== "application/json") {
		return resp.text(
			"please provide a valid JSON object with the following properties: repo, prompt. Repo should be a valid Github repo name. Prompt should be a valid task description.",
		);
	}

	const task = await req.data.object<{ repo: string; prompt: string }>();

	if (!task?.repo) {
		return resp.text("please provide a repo");
	}
	if (!task?.prompt) {
		return resp.text("please provide a prompt");
	}

	let repo = task.repo;
	if (repo.startsWith("https://github.com/")) {
		repo = repo.replace("https://github.com/", "");
	}

	const cacheKey = `repomix-${repo}`;

	const cached = await ctx.kv.get("github-repo-contents", cacheKey);
	let content: string;

	if (!cached.exists) {
		const res = await fetch("https://api.repomix.com/api/pack", {
			method: "POST",
			body: `------WebKitFormBoundary0Og4fdtmGKn2v3wq\r\nContent-Disposition: form-data; name="url"\r\n\r\nhttps://github.com/${task.repo}\r\n------WebKitFormBoundary0Og4fdtmGKn2v3wq\r\nContent-Disposition: form-data; name="format"\r\n\r\nmarkdown\r\n------WebKitFormBoundary0Og4fdtmGKn2v3wq\r\nContent-Disposition: form-data; name="options"\r\n\r\n{"removeComments":false,"removeEmptyLines":false,"showLineNumbers":false,"fileSummary":true,"directoryStructure":true,"outputParsable":false,"compress":false}\r\n------WebKitFormBoundary0Og4fdtmGKn2v3wq--\r\n`,
			headers: {
				accept: "*/*",
				"accept-language": "en-US,en;q=0.9",
				"content-type":
					"multipart/form-data; boundary=----WebKitFormBoundary0Og4fdtmGKn2v3wq",
			},
		});

		if (!res.ok) {
			return resp.json({
				success: false,
				error: `Failed to process repo: ${res.status}`,
			});
		}

		const body = (await res.json()) as { content: string };
		await ctx.kv.set("github-repo-contents", cacheKey, body.content, {
			contentType: "text/plain",
			ttl: 60_000 * 5,
		});
		content = body.content;
	} else {
		content = await cached.data.text();
	}

	const prompt = `You are a helpful software developer assistant that can answer questions and help with tasks related to the Github repo: ${task.repo}.
Here is the documentation for the repo:
${content}

Please help me with the following task:
${task.prompt}
		`;

	const { textStream } = await streamText({
		model: google("gemini-2.5-flash-preview-04-17"),
		providerOptions: {
			google: {
				thinkingConfig: {
					thinkingBudget: 2048,
				},
			} satisfies GoogleGenerativeAIProviderOptions,
		},
		prompt,
		onError: (err) => {
			throw err;
		},
	});

	return resp.stream(textStream, "text/markdown");
}
