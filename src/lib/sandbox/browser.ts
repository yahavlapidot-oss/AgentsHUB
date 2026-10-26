/**
 * A real browser for agents with a cloud computer: Playwright and Chromium run
 * inside the agent's own sandbox, so a page's scripts never touch this server.
 * The first use in a sandbox installs them (about a minute); later calls reuse
 * them. It costs only sandbox time. What a page says is outside content.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool, type ToolContext } from "../agent-tools";
import { markTainted, untrusted } from "../untrusted";
import { askFirst } from "../tools/gate";
import { WORKDIR } from "./session";

const HOME = "/home/user/.browser";
const PLAYWRIGHT = process.env.SANDBOX_PLAYWRIGHT_VERSION ?? "1.49.1";

const Step = z.discriminatedUnion("do", [
  z.object({ do: z.literal("goto"), url: z.string().url() }),
  z.object({ do: z.literal("click"), selector: z.string().min(1).max(500) }),
  z.object({ do: z.literal("fill"), selector: z.string().min(1).max(500), value: z.string().max(10_000) }),
  z.object({ do: z.literal("press"), key: z.string().min(1).max(50) }),
  z.object({ do: z.literal("wait"), selector: z.string().max(500).optional(), ms: z.number().int().min(0).max(30_000).optional() }),
  z.object({ do: z.literal("text"), selector: z.string().max(500).optional() }),
  z.object({ do: z.literal("screenshot"), path: z.string().max(300).optional(), fullPage: z.boolean().optional() }),
]);
type Step = z.infer<typeof Step>;

/** Runs in the sandbox: reads steps as JSON, prints one JSON line of results. */
const SCRIPT = `
const { chromium } = require("playwright");
const steps = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15000);
  const out = [];
  try {
    for (const s of steps) {
      if (s.do === "goto") { await page.goto(s.url, { waitUntil: "domcontentloaded" }); out.push({ do: "goto", url: page.url(), title: await page.title() }); }
      else if (s.do === "click") { await page.click(s.selector); out.push({ do: "click", ok: true }); }
      else if (s.do === "fill") { await page.fill(s.selector, s.value); out.push({ do: "fill", ok: true }); }
      else if (s.do === "press") { await page.keyboard.press(s.key); out.push({ do: "press", ok: true }); }
      else if (s.do === "wait") { if (s.selector) await page.waitForSelector(s.selector); else await page.waitForTimeout(s.ms ?? 1000); out.push({ do: "wait", ok: true }); }
      else if (s.do === "text") { const t = await (s.selector ? page.locator(s.selector).first().innerText() : page.innerText("body")); out.push({ do: "text", text: t.slice(0, 20000) }); }
      else if (s.do === "screenshot") { await page.screenshot({ path: s.path, fullPage: !!s.fullPage }); out.push({ do: "screenshot", path: s.path }); }
    }
  } catch (e) { out.push({ error: String(e && e.message || e).slice(0, 1000) }); }
  console.log(JSON.stringify({ url: page.url(), steps: out }));
  await browser.close();
})();
`;

async function ensureBrowser(ctx: ToolContext): Promise<void> {
  const sandbox = ctx.sandbox!;
  const ready = await sandbox.run(`test -f ${HOME}/ready && echo yes || echo no`, { cwd: "/tmp" });
  if (ready.stdout.trim() === "yes") return;
  const install = await sandbox.run(
    `mkdir -p ${HOME} && cd ${HOME} && npm init -y >/dev/null && npm i playwright@${PLAYWRIGHT} >/dev/null 2>&1 && (sudo npx playwright install --with-deps chromium || npx playwright install --with-deps chromium) >/dev/null 2>&1 && touch ready`,
    { cwd: "/tmp", timeoutMs: 300_000 },
  );
  if (install.exitCode !== 0) throw new ToolInputError(`Couldn't install the browser: ${(install.stderr || install.stdout).slice(-1_000)}`);
}

export const BROWSER_TOOLS: AgentTool[] = [
  tool({
    name: "browser",
    description:
      "Use a real browser (Chromium) in your cloud computer for pages that need JavaScript, clicking or forms. Give a list of steps: goto, click, fill, press, wait, text, screenshot. Screenshots are saved in your work folder; give them to the user with save_artifact. Logging in, submitting forms or buying anything needs the user's approval first: ask with request_approval. The first use takes about a minute to set up.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: 'Steps in order, e.g. [{"do":"goto","url":"https://example.com"},{"do":"text"}]',
          items: {
            type: "object",
            properties: {
              do: { type: "string", enum: ["goto", "click", "fill", "press", "wait", "text", "screenshot"] },
              url: str("goto: the address"),
              selector: str("click, fill, wait, text: a CSS or text= selector"),
              value: str("fill: what to type"),
              key: str("press: e.g. Enter"),
              ms: { type: "number", description: "wait: milliseconds" },
              path: str("screenshot: file name in the work folder"),
              fullPage: { type: "boolean", description: "screenshot: the whole page" },
            },
            required: ["do"],
          },
        },
      },
      required: ["steps"],
    },
    args: z.object({ steps: z.array(Step).min(1).max(30) }),
    run: async ({ steps }, ctx) => {
      if (!ctx.sandbox) throw new ToolInputError("The browser needs a cloud computer");
      // Typing into a page after reading outside content could be someone else's instruction.
      if (ctx.taint?.tainted && steps.some((s) => s.do === "fill")) {
        const asked = await askFirst(ctx, {
          action: `Browser: fill a form after reading outside content`,
          service: "Browser",
          details: JSON.stringify(steps, null, 2).slice(0, 5_000),
        });
        if (!asked.ok) return asked.refused;
      }
      await ensureBrowser(ctx);
      const named: Step[] = steps.map((s, i) => (s.do === "screenshot" ? { ...s, path: `${WORKDIR}/${(s.path ?? `screenshot-${Date.now()}-${i}.png`).replace(/^\/+|\.\.+/g, "")}` } : s));
      const stepsFile = `${HOME}/steps-${Date.now()}.json`;
      await ctx.sandbox.writeFile(`${HOME}/run.cjs`, SCRIPT);
      await ctx.sandbox.writeFile(stepsFile, JSON.stringify(named));
      const r = await ctx.sandbox.run(`node run.cjs ${stepsFile}`, { cwd: HOME, timeoutMs: 180_000 });
      const line = r.stdout.trim().split("\n").pop() ?? "";
      let result: unknown;
      try {
        result = JSON.parse(line);
      } catch {
        throw new ToolInputError(`The browser failed: ${(r.stderr || r.stdout).slice(-1_500)}`);
      }
      markTainted(ctx.taint, "browser");
      return untrusted("web page (browser)", JSON.stringify(result));
    },
  }),
];
